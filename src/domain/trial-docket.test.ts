import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { scenarios } from '../modules/registry'
import { createInitialSession } from './simulation'
import { createTrialDocket } from './trial-docket'

describe('trial docket records', () => {
  it('creates a PDF-backed trial docket for every seeded scenario', () => {
    for (const scenario of scenarios) {
      const docket = createTrialDocket(createInitialSession(scenario.id))
      expect(docket.caption).toBeTruthy()
      expect(docket.entries.length).toBeGreaterThanOrEqual(4)

      for (const entry of docket.entries) {
        expect(entry.documents.length).toBeGreaterThanOrEqual(1)
        for (const document of entry.documents) {
          expect(document.mimeType).toBe('application/pdf')
          expect(document.fileName.endsWith('.pdf')).toBe(true)
          expect(document.sizeBytes).toBeGreaterThan(0)
          expect(document.pageCount).toBeGreaterThan(0)
          expect(Boolean(document.publicUrl ?? document.sourceUrl ?? document.storageId)).toBe(true)

          if (document.publicUrl) {
            const filePath = join(process.cwd(), 'public', document.publicUrl)
            expect(existsSync(filePath)).toBe(true)
            expect(statSync(filePath).size).toBe(document.sizeBytes)
            expect(readFileSync(filePath, 'utf8').startsWith('%PDF-1.4')).toBe(true)
          }
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
