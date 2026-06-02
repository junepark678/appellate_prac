import { createSyntheticPdf, wrapPdfWords } from './synthetic-pdf'
import type { TrialDocketDocument, TrialDocketEntry } from './types'
import { findCa4FormTemplate } from '../packages/trial-record-pdfs'

export function ca4FormTemplateForTrialDocketDocument(
  entry: TrialDocketEntry,
  document: TrialDocketDocument,
) {
  return findCa4FormTemplate(`${document.label} ${entry.title} ${document.fileName}`)
}

export function canCreateTrialDocketDocumentPdf(document: TrialDocketDocument) {
  return (
    document.mimeType === 'application/pdf' && Boolean(document.extractedText)
  )
}

export function createTrialDocketDocumentPdf(
  entry: TrialDocketEntry,
  document: TrialDocketDocument,
) {
  const text =
    document.extractedText ?? `${document.label}. ${entry.title}. ${entry.text}`
  return createSyntheticPdf(
    `${entry.title} - ${document.label}`,
    wrapPdfWords(text),
  )
}
