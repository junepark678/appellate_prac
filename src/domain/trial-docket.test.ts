import { describe, expect, it } from 'vitest'

import { scenarios } from '../modules/registry'
import { createInitialSession } from './simulation'
import { createTrialDocket } from './trial-docket'

describe('trial docket records', () => {
  it('creates a PDF-backed trial docket for every seeded scenario', () => {
    for (const scenario of scenarios) {
      const docket = createTrialDocket(createInitialSession(scenario.id))
      expect(docket.caption).toBeTruthy()
      expect(docket.entries.length).toBeGreaterThanOrEqual(18)
      expect(
        docket.entries.filter((entry) => entry.documents.length > 0).length,
      ).toBeGreaterThanOrEqual(4)

      for (const entry of docket.entries) {
        for (const document of entry.documents) {
          expect(document.mimeType).toBe('application/pdf')
          expect(document.fileName.endsWith('.pdf')).toBe(true)
          expect(document.sizeBytes).toBeGreaterThan(0)
          expect(document.pageCount).toBeGreaterThan(0)
          expect('publicUrl' in document).toBe(false)
        }
      }
    }
  })

  it('stores scenario-specific extracted text for synthetic trial-record PDFs', () => {
    for (const scenario of scenarios.filter((candidate) => candidate.source === 'synthetic')) {
      const docket = createTrialDocket(createInitialSession(scenario.id))
      const text = docket.entries.flatMap((entry) =>
        entry.documents.map((document) => document.extractedText ?? ''),
      ).join('\n')
      expect(text).toContain(scenario.proceduralPosture)
      expect(
        scenario.meritsRecord.some((recordFact) => text.includes(recordFact)) ||
          (scenario.recordExcerpts ?? []).some((excerpt) => text.includes(excerpt.text)),
      ).toBe(true)
    }
  })
})
