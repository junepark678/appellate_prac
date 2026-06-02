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

      for (const entry of docket.entries) {
        expect(entry.documents.length).toBeGreaterThanOrEqual(1)
        for (const document of entry.documents) {
          expect(document.mimeType).toBe('application/pdf')
          expect(document.fileName.endsWith('.pdf')).toBe(true)
          expect(document.fileUrl).toBeUndefined()
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

  it('does not append appellate session filings to fallback trial dockets', () => {
    const baseSession = createInitialSession()
    const { trialDocket: _trialDocket, ...scenarioWithoutTrialDocket } = baseSession.scenario
    const session = {
      ...baseSession,
      scenario: scenarioWithoutTrialDocket,
      docketEntries: [
        ...baseSession.docketEntries,
        {
          id: 'dkt_appellate_opening_brief',
          entryNumber: baseSession.docketEntries.length + 1,
          filedAt: '2026-03-10T15:00:00.000Z',
          actorRole: 'appellant' as const,
          title: 'Opening Brief',
          text: 'Opening brief filed in the court of appeals.',
          filingId: 'filing_opening_brief',
          ruleRefs: [],
        },
      ],
    }

    const docket = createTrialDocket(session)

    expect(docket.entries.map((entry) => entry.title)).not.toContain('Opening Brief')
    expect(docket.entries).toHaveLength(20)
  })
})
