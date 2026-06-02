import { describe, expect, it } from 'vitest'

import {
  canCreateTrialDocketDocumentPdf,
  createTrialDocketDocumentPdf,
} from './trial-docket-download'
import type { TrialDocketEntry } from './types'

const entry: TrialDocketEntry = {
  id: 'entry-1',
  entryNumber: 1,
  filedAt: '2026-01-01T00:00:00.000Z',
  title: 'Order Granting Summary Judgment',
  text: 'The district court entered judgment.',
  documents: [],
}

describe('trial docket document downloads', () => {
  it('creates a PDF from extracted docket document text', () => {
    const document = {
      id: 'doc-1',
      label: 'Order',
      fileName: '001-order.pdf',
      mimeType: 'application/pdf' as const,
      source: 'synthetic' as const,
      sizeBytes: 1024,
      pageCount: 1,
      extractedText: 'Scenario-specific order text.',
    }

    expect(canCreateTrialDocketDocumentPdf(document)).toBe(true)

    const pdf = createTrialDocketDocumentPdf(entry, document)

    expect(pdf).toContain('%PDF-1.4')
    expect(pdf).toContain('Order Granting Summary Judgment - Order')
    expect(pdf).toContain('Scenario-specific order text.')
  })

  it('does not offer generated downloads without extracted PDF text', () => {
    expect(
      canCreateTrialDocketDocumentPdf({
        id: 'doc-2',
        label: 'Order',
        fileName: '001-order.pdf',
        mimeType: 'application/pdf',
        source: 'synthetic',
        sizeBytes: 1024,
        pageCount: 1,
      }),
    ).toBe(false)
  })
})
