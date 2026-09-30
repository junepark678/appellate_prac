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
  analyzeExtractedText,
  detectAppendixCitations,
  detectCertificates,
  detectRecordCitations,
  detectSections,
  pdfJsAnalyzer,
} from './pdfjs-analyzer'

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

describe('pdf.js document analyzer helpers', () => {
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
