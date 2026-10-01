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

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  analyzeExtractedText,
  detectAppendixCitations,
  detectCertificates,
  detectRecordCitations,
  detectSections,
  pdfJsAnalyzer,
} from './pdfjs-analyzer'

const require = createRequire(import.meta.url)

const sampleBriefText = `
Jurisdictional Statement
This Court has jurisdiction under 28 U.S.C. § 1291.
Statement of Issues
Whether summary judgment ignored comparator evidence.
Standard of Review
The Court reviews summary judgment de novo.
Argument
The record shows comparator evidence at J.A. 42 and R. at 18.
Conclusion
The judgment should be vacated.
Certificate of Service
I served all parties by CM/ECF.
Certificate of Compliance
This brief contains 7,200 words.
`

function createTinyPdf(text: string) {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`,
  ]
  let pdf = '%PDF-1.7\n'
  const offsets = [0]

  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const crossReferenceOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`

  return new TextEncoder().encode(pdf)
}

describe('pdf.js document analyzer helpers', () => {
  it('extracts text from a valid PDF through the PDF.js analyzer and matching legacy worker import', async () => {
    const sourceText = 'PDF.js legacy worker pairing successfully extracts real page text'
    const bytes = createTinyPdf(sourceText)
    const bundledWorkerUrl = pdfjsLib.GlobalWorkerOptions.workerSrc
    const originalWorkerSrc = bundledWorkerUrl
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href

    let analysis
    try {
      analysis = await pdfJsAnalyzer.analyze({
        fileName: 'one-page-test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        extractedSignals: [],
        arrayBuffer: async () => bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      })
    } finally {
      pdfjsLib.GlobalWorkerOptions.workerSrc = originalWorkerSrc
    }

    expect(bundledWorkerUrl).toContain('/legacy/build/pdf.worker.mjs')
    expect(analysis.analyzerId).toBe('pdfjs-analyzer')
    expect(analysis.textExtractionStatus).toBe('extracted')
    expect(analysis.pageCount).toBe(1)
    expect(analysis.extractedPageText?.[0]?.text).toContain(sourceText)
  })

  it('falls back to filename and signal analysis when bytes are unavailable', async () => {
    const analysis = await pdfJsAnalyzer.analyze({
      fileName: 'opening-brief-service.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100_000,
      extractedSignals: ['argument', 'certificate of service'],
    })

    expect(analysis.analyzerId).toBe('pdf-signal-analyzer')
    expect(analysis.textExtractionStatus).toBe('fallback')
    expect(analysis.certificateOfServiceDetected).toBe(true)
  })

  it('detects service and compliance certificates', () => {
    const result = detectCertificates(sampleBriefText)
    expect(result.certificateOfServiceDetected).toBe(true)
    expect(result.certificateOfComplianceDetected).toBe(true)
    expect(result.certificateSnippets.length).toBeGreaterThan(0)
  })

  it('detects record and appendix citations', () => {
    expect(detectRecordCitations(sampleBriefText)).toContain('R. at 18')
    expect(detectAppendixCitations(sampleBriefText)).toContain('J.A. 42')
  })

  it('detects appellate brief sections', () => {
    const sectionIds = detectSections(sampleBriefText).map((section) => section.id)
    expect(sectionIds).toContain('jurisdiction')
    expect(sectionIds).toContain('issues')
    expect(sectionIds).toContain('standard_of_review')
    expect(sectionIds).toContain('argument')
    expect(sectionIds).toContain('conclusion')
  })

  it('builds a rich analysis summary from extracted page text', () => {
    const analysis = analyzeExtractedText({
      analyzerId: 'test-analyzer',
      fileName: 'opening-brief.pdf',
      fileSizeBytes: 120_000,
      mimeType: 'application/pdf',
      pageCount: 2,
      extractedPageText: [
        { pageNumber: 1, text: sampleBriefText },
        { pageNumber: 2, text: 'Additional argument cites Fed. R. App. P. 28.' },
      ],
    })

    expect(analysis.pageCount).toBe(2)
    expect(analysis.searchableText).toBe(true)
    expect(analysis.wordCount).toBeGreaterThan(20)
    expect(analysis.legalCitations?.join(' ')).toContain('Fed. R. App. P. 28')
  })
})
