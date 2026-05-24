import { describe, expect, it } from 'vitest'

import { createInitialSession, fileDraft } from '../domain/simulation'
import type { FilingDraft, UploadedDocument } from '../domain/types'
import {
  documentAnalyzers,
  filingEventModules,
  getAvailableFilingEvents,
  moduleManifests,
  procedureModules,
  ruleModules,
  validateModuleRegistry,
} from './registry'

const noticePdf: UploadedDocument = {
  id: 'doc_1',
  fileName: 'notice-of-appeal.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 140_000,
  extractedSignals: ['notice of appeal'],
}

function draft(eventId: string): FilingDraft {
  return {
    eventId,
    participantRole: 'appellant',
    title: eventId,
    documents: [noticePdf],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

describe('module registry', () => {
  it('validates cross-module references', () => {
    expect(validateModuleRegistry()).toEqual([])
  })

  it('indexes the first court, rule, filing, and procedure modules', () => {
    expect(moduleManifests.some((manifest) => manifest.moduleId === 'us-federal-ca4')).toBe(
      true,
    )
    expect(ruleModules.some((module) => module.id === 'frap-2025')).toBe(true)
    expect(filingEventModules.some((module) => module.id === 'opening_brief')).toBe(
      true,
    )
    expect(
      procedureModules.some(
        (module) => module.id === 'federal-civil-appeal-standard-briefing',
      ),
    ).toBe(true)
  })

  it('exposes available filing events from the procedure module', () => {
    let session = createInitialSession()
    expect(
      getAvailableFilingEvents(session).find((event) => event.eventId === 'notice_of_appeal')
        ?.available,
    ).toBe(true)

    session = fileDraft(session, draft('notice_of_appeal'))
    expect(
      getAvailableFilingEvents(session).find(
        (event) => event.eventId === 'appearance_disclosure',
      )?.available,
    ).toBe(true)
  })

  it('runs document analysis through the analyzer boundary', async () => {
    const analysis = await documentAnalyzers[0].analyze({
      fileName: 'opening-brief-service-compliance.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 200_000,
      pageCount: 32,
      extractedSignals: ['argument'],
    })

    expect(analysis.searchableText).toBe(true)
    expect(analysis.certificateOfServiceDetected).toBe(true)
    expect(analysis.certificateOfComplianceDetected).toBe(true)
  })
})
