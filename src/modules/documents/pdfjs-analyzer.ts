/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

import { pdfSignalAnalyzer } from './pdf-signal-analyzer'
import type { DocumentAnalysis, DocumentAnalyzer, DocumentSection, UploadedFile } from '../types'

type PdfPageProxy = {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>
}

type PdfDocumentProxy = {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxy>
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const sectionPatterns: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'jurisdiction', label: 'Jurisdictional Statement', pattern: /\b(jurisdictional statement|statement of jurisdiction|jurisdiction)\b/i },
  { id: 'issues', label: 'Issues Presented', pattern: /\b(statement of issues|issues? presented|questions? presented)\b/i },
  { id: 'standard_of_review', label: 'Standard of Review', pattern: /\bstandard of review\b/i },
  { id: 'argument', label: 'Argument', pattern: /\b(argument|summary of argument)\b/i },
  { id: 'conclusion', label: 'Conclusion / Relief Requested', pattern: /\b(conclusion|relief requested|request for relief)\b/i },
  { id: 'certificate_of_service', label: 'Certificate of Service', pattern: /\bcertificate of service\b/i },
  { id: 'certificate_of_compliance', label: 'Certificate of Compliance', pattern: /\b(certificate of compliance|type-volume certificate|word count certificate)\b/i },
]

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeText(value: string) {
  return normalizeWhitespace(value.replace(/\u0000/g, ' '))
}

function uniqueMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)]
    .map((match) => normalizeWhitespace(match[0]))
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .slice(0, 80)
}

function snippetAround(text: string, index: number, radius = 180) {
  return normalizeWhitespace(text.slice(Math.max(0, index - radius), index + radius))
}

function wordCount(text: string) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

export function detectSections(text: string): DocumentSection[] {
  const hits = sectionPatterns
    .map((section) => {
      const match = section.pattern.exec(text)
      return match?.index === undefined
        ? null
        : {
            id: section.id,
            label: section.label,
            startIndex: match.index,
            textSnippet: snippetAround(text, match.index),
          }
    })
    .filter((section): section is Omit<DocumentSection, 'endIndex'> => section !== null)
    .sort((a, b) => a.startIndex - b.startIndex)

  return hits.map((section, index) => ({
    ...section,
    ...(hits[index + 1] ? { endIndex: hits[index + 1].startIndex } : {}),
  }))
}

export function detectCertificates(text: string) {
  const serviceIndex = text.search(/\bcertificate of service\b/i)
  const complianceIndex = text.search(/\b(certificate of compliance|type-volume certificate|word count certificate)\b/i)
  const snippets = [serviceIndex, complianceIndex]
    .filter((index) => index >= 0)
    .map((index) => snippetAround(text, index))

  return {
    certificateOfServiceDetected: serviceIndex >= 0,
    certificateOfComplianceDetected: complianceIndex >= 0,
    certificateSnippets: snippets,
  }
}

export function detectLegalCitations(text: string) {
  return uniqueMatches(
    text,
    /\b(?:\d+\s+U\.S\.C\.?\s+§+\s*\d+[a-z0-9().-]*|Fed\.\s*R\.\s*App\.\s*P\.\s*\d+(?:\.\d+)?|FRAP\s*\d+(?:\.\d+)?|[A-Z][A-Za-z.&'\- ]+\s+v\.\s+[A-Z][A-Za-z.&'\- ]+,\s+\d+\s+[A-Z][A-Za-z. ]+\s+\d+)\b/g,
  )
}

export function detectRecordCitations(text: string) {
  return uniqueMatches(
    text,
    /\b(?:R\.?\s*(?:at|pp?\.?)\s*\d+(?:-\d+)?|Record\s+(?:at|pp?\.?)\s*\d+(?:-\d+)?|ECF\s+No\.?\s*\d+(?:-\d+)?(?:\s+at\s+\d+)?)\b/gi,
  )
}

export function detectAppendixCitations(text: string) {
  return uniqueMatches(
    text,
    /\b(?:J\.?A\.?\s*\d+(?:-\d+)?|JA\s*\d+(?:-\d+)?|Joint Appendix\s+(?:at\s+)?\d+(?:-\d+)?|App\.?\s*\d+(?:-\d+)?)\b/gi,
  )
}

function detectPrivacySealWarnings(text: string, fileName: string) {
  const warnings: string[] = []
  const target = `${fileName} ${text}`

  if (/\b(sealed|under seal|confidential|redacted)\b/i.test(target)) {
    warnings.push('Document text or filename suggests seal, redaction, or confidentiality review.')
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
    warnings.push('Potential Social Security number pattern detected.')
  }
  if (/\b(?:minor child|juvenile|date of birth|dob)\b/i.test(text)) {
    warnings.push('Potential personal-identifier content detected.')
  }

  return warnings
}

export function analyzeExtractedText(args: {
  analyzerId: string
  fileName: string
  fileSizeBytes: number
  mimeType: string
  pageCount?: number
  extractedPageText?: Array<{ pageNumber: number; text: string }>
  warnings?: string[]
}): DocumentAnalysis {
  const normalizedText = normalizeText(
    args.extractedPageText?.map((page) => page.text).join('\n\n') ?? '',
  )
  const sections = detectSections(normalizedText)
  const certificates = detectCertificates(normalizedText)
  const legalCitations = detectLegalCitations(normalizedText)
  const recordCitations = detectRecordCitations(normalizedText)
  const appendixCitations = detectAppendixCitations(normalizedText)
  const privacySealWarnings = detectPrivacySealWarnings(normalizedText, args.fileName)
  const searchableText = normalizedText.length > 40
  const words = wordCount(normalizedText)

  return {
    analyzerId: args.analyzerId,
    ...(typeof args.pageCount === 'number' ? { pageCount: args.pageCount } : {}),
    fileSizeBytes: args.fileSizeBytes,
    mimeType: args.mimeType,
    searchableText,
    ...(args.extractedPageText ? { extractedPageText: args.extractedPageText } : {}),
    ...(normalizedText ? { normalizedText } : {}),
    wordCount: words,
    sectionMap: sections,
    certificateOfServiceDetected: certificates.certificateOfServiceDetected,
    certificateOfComplianceDetected: certificates.certificateOfComplianceDetected,
    certificateSnippets: certificates.certificateSnippets,
    legalCitations,
    recordCitations,
    appendixCitations,
    sealedOrRedactionWarning: privacySealWarnings.length > 0,
    privacySealWarnings,
    textExtractionStatus: searchableText ? 'extracted' : 'not_searchable',
    extractionConfidence: searchableText
      ? Math.min(0.98, 0.55 + Math.min(words, 1200) / 3000)
      : 0.15,
    warnings: [
      ...(args.warnings ?? []),
      ...(!searchableText ? ['PDF has little or no searchable text. OCR is not implemented in this phase.'] : []),
      ...privacySealWarnings,
    ],
  }
}

function fallbackAnalysis(file: UploadedFile, reason: string): Promise<DocumentAnalysis> {
  return pdfSignalAnalyzer.analyze(file).then((analysis) => ({
    ...analysis,
    textExtractionStatus: 'fallback' as const,
    extractionConfidence: 0.2,
    warnings: [...analysis.warnings, reason],
  }))
}

export const pdfJsAnalyzer: DocumentAnalyzer = {
  id: 'pdfjs-analyzer',
  async analyze(file) {
    if (file.mimeType !== 'application/pdf') {
      return fallbackAnalysis(file, 'pdf.js extraction skipped because the upload is not a PDF.')
    }

    if (!file.arrayBuffer) {
      return fallbackAnalysis(file, 'pdf.js extraction skipped because file bytes were unavailable.')
    }

    try {
      const data = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(data),
        isEvalSupported: false,
      } as Parameters<typeof pdfjsLib.getDocument>[0])
      const pdf = (await loadingTask.promise) as PdfDocumentProxy
      const extractedPageText: Array<{ pageNumber: number; text: string }> = []

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const content = await page.getTextContent()
        extractedPageText.push({
          pageNumber,
          text: normalizeWhitespace(
            content.items.map((item) => item.str ?? '').filter(Boolean).join(' '),
          ),
        })
      }

      return analyzeExtractedText({
        analyzerId: this.id,
        fileName: file.fileName,
        fileSizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        pageCount: pdf.numPages,
        extractedPageText,
        warnings: [
          ...(file.sizeBytes > 25 * 1024 * 1024
            ? ['Document exceeds the simulator e-filing size warning threshold.']
            : []),
        ],
      })
    } catch {
      return fallbackAnalysis(file, 'pdf.js extraction failed; filename and signal fallback was used.')
    }
  },
}
