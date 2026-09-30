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

import { describe, expect, it } from 'vitest'

import {
  ca4FormTemplateForTrialDocketDocument,
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

  it('matches official CA4 form templates for premade form PDFs', () => {
    const document = {
      id: 'doc-3',
      label: 'Transcript Order Form',
      fileName: 'transcript-order-form.pdf',
      mimeType: 'application/pdf' as const,
      source: 'synthetic' as const,
      sizeBytes: 1024,
      pageCount: 1,
    }

    const template = ca4FormTemplateForTrialDocketDocument(entry, document)

    expect(template?.label).toBe('Transcript Order Form')
    expect(template?.sourceUrl).toContain('ca4.uscourts.gov')
  })
})
