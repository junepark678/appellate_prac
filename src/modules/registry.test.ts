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

import { applyToolCall, createInitialSession, fileDraft } from '../domain/simulation'
import type { FilingDraft, UploadedDocument } from '../domain/types'
import {
  documentAnalyzers,
  filingEventModules,
  getAvailableFilingEvents,
  getFilingEvent,
  moduleManifests,
  procedureModules,
  ruleRefs,
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

  it('allows writ answers after the clerk opens the answer deadline', () => {
    let session = createInitialSession('synthetic-ca4-original-writ-discovery')
    expect(
      getAvailableFilingEvents(session).find(
        (event) => event.eventId === 'answer_to_writ_petition',
      )?.available,
    ).toBe(false)

    session = applyToolCall(session, {
      tool: 'setDeadline',
      actorId: 'ca4_clerk',
      label: 'Answer to writ petition due',
      targetEventId: 'answer_to_writ_petition',
      offsetDays: 14,
      sourceRuleRefs: [ruleRefs.frap21],
    })

    expect(
      getAvailableFilingEvents(session).find(
        (event) => event.eventId === 'answer_to_writ_petition',
      )?.available,
    ).toBe(true)
  })

  it('wires criminal brief events to criminal follow-on deadlines', () => {
    const civilOpening = getFilingEvent('us-federal-ca4-civil-appeal', 'opening_brief')
    const criminalOpening = getFilingEvent('us-federal-ca4-criminal-appeal', 'opening_brief')
    const criminalAppellee = getFilingEvent('us-federal-ca4-criminal-appeal', 'appellee_brief')

    expect(civilOpening?.deadlineEffects[0]?.offsetDays).toBe(30)
    expect(criminalOpening?.deadlineEffects[0]?.targetEventId).toBe('appellee_brief')
    expect(criminalOpening?.deadlineEffects[0]?.offsetDays).toBe(21)
    expect(criminalAppellee?.deadlineEffects[0]?.targetEventId).toBe('reply_brief')
    expect(criminalAppellee?.deadlineEffects[0]?.offsetDays).toBe(10)
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
