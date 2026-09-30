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

import { defaultFilingMetadata } from '../filing/ecf'
import { preflightFilingSubmission } from '../rules/executable-constraints'
import { createInitialSession } from '../simulation'
import { briefAnalysisIssues } from './brief-analysis'
import type { FilingSubmission, UploadedDocument } from '../types'

function analyzedDocument(text: string): UploadedDocument {
  return {
    id: 'brief',
    fileName: 'opening-brief.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 140_000,
    pageCount: 24,
    extractedText: 'filename fallback should not control when analysis exists',
    extractedSignals: [],
    textExtractionStatus: 'extracted',
    wordCount: text.split(/\s+/).filter(Boolean).length,
    analysisId: 'analysis_brief',
    analysis: {
      analyzerId: 'test',
      pageCount: 24,
      fileSizeBytes: 140_000,
      mimeType: 'application/pdf',
      searchableText: true,
      normalizedText: text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      sectionMap: [
        { id: 'issues', label: 'Issues Presented', startIndex: 0, textSnippet: 'Issues Presented' },
        { id: 'standard_of_review', label: 'Standard of Review', startIndex: 20, textSnippet: 'Standard of Review' },
        { id: 'argument', label: 'Argument', startIndex: 40, textSnippet: 'Argument' },
      ],
      certificateOfServiceDetected: true,
      certificateOfComplianceDetected: true,
      certificateSnippets: ['Certificate of Service', 'Certificate of Compliance'],
      legalCitations: ['Fed. R. App. P. 28'],
      recordCitations: ['R. at 18'],
      appendixCitations: ['J.A. 42'],
      sealedOrRedactionWarning: false,
      privacySealWarnings: [],
      textExtractionStatus: 'extracted',
      extractionConfidence: 0.9,
      warnings: [],
    },
  }
}

function submission(document: UploadedDocument): FilingSubmission {
  return {
    eventId: 'opening_brief',
    participantRole: 'appellant',
    title: 'Opening Brief',
    mainDocument: document,
    attachments: [],
    metadata: defaultFilingMetadata('opening_brief'),
    notes: '',
  }
}

describe('brief analysis', () => {
  it('checks issue coverage against scenario issues', () => {
    const session = createInitialSession()
    const result = briefAnalysisIssues(
      session,
      submission(
        analyzedDocument(
          'Issues Presented. Standard of Review. Argument. R. at 18. J.A. 42. Certificate of Service. Certificate of Compliance.',
        ),
      ),
    )

    expect(result.some((issue) => issue.code?.startsWith('issue_coverage_'))).toBe(true)
  })

  it('preflight uses document analysis instead of filename signals', () => {
    const session = createInitialSession()
    const document = analyzedDocument(
      'Issues Presented. Standard of Review. Argument. Comparator evidence retaliation summary judgment. R. at 18. J.A. 42. Certificate of Service. Certificate of Compliance.',
    )
    const result = preflightFilingSubmission(session, submission(document))

    expect(
      result.issues.some((issue) => issue.code === 'record_citations_missing'),
    ).toBe(false)
    expect(
      result.issues.some((issue) => issue.code === 'standard_of_review_missing'),
    ).toBe(false)
  })
})
