import { createSyntheticPdf, wrapPdfWords } from './synthetic-pdf'
import type { TrialDocketDocument, TrialDocketEntry } from './types'

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
