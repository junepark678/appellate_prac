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

import { createInitialSession, fileDraft } from '../simulation'
import type { FilingDraft, FilingSubmission, UploadedDocument } from '../types'
import {
  buildNoticeOfDocketActivityPreview,
  defaultFilingMetadata,
  getAvailableEcfEventDefinitions,
  preflightEcfFiling,
  serviceRecipientsForSubmission,
  submitEcfFiling,
  validateEcfWizardCompleteness,
} from './ecf'
import { getCa4EcfCatalogEvent } from './ca4-ecf-catalog'

const noticePdf: UploadedDocument = {
  id: 'notice',
  fileName: 'notice-of-appeal.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Notice of appeal from final judgment.',
  extractedSignals: ['notice of appeal'],
}

const motionPdf: UploadedDocument = {
  id: 'motion',
  fileName: 'motion.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedText: 'Motion requesting procedural relief.',
  extractedSignals: ['motion'],
}

function submission(eventId: string, document: UploadedDocument): FilingSubmission {
  return {
    eventId,
    participantRole: 'appellant',
    title: eventId,
    mainDocument: document,
    attachments: [],
    metadata: {
      ...defaultFilingMetadata(eventId),
      representedPartyId: 'appellant',
    },
    notes: '',
  }
}

function draft(eventId: string, document: UploadedDocument): FilingDraft {
  return {
    eventId,
    participantRole: 'appellant',
    title: eventId,
    documents: [document],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

describe('ECF workflow completeness', () => {
  it('exposes expanded Fourth Circuit form workflows from the catalog', () => {
    const session = createInitialSession()
    const events = getAvailableEcfEventDefinitions(session)
    const eventIds = new Set(events.map((event) => event.eventId))

    expect([...eventIds]).toEqual(
      expect.arrayContaining([
        'ifp_application',
        'plra_application',
        'certificate_of_confidentiality',
        'highly_sensitive_document_certificate',
        'sealed_brief',
        'sealed_appendix',
        'oral_argument_acknowledgment',
        'oral_argument_conflict_notice',
        'costs_objection',
        'certiorari_information_sheet',
        'certiorari_status_form',
      ]),
    )

    expect(getCa4EcfCatalogEvent('appearance_disclosure')?.requiredDocuments).toEqual(
      expect.arrayContaining(['Appearance of counsel PDF', 'Disclosure statement PDF']),
    )
    expect(getCa4EcfCatalogEvent('sealed_brief')?.requiredDocuments).toEqual(
      expect.arrayContaining(['Certificate of confidentiality PDF', 'Public redacted brief PDF']),
    )
    expect(events.find((event) => event.eventId === 'oral_argument_acknowledgment')?.category).toBe('argument')
  })

  it('defaults fee status for IFP and PLRA fee-waiver workflows', () => {
    expect(defaultFilingMetadata('ifp_application').feePaymentStatus).toBe('pending')
    expect(defaultFilingMetadata('plra_application').feePaymentStatus).toBe('pending')
  })

  it('gates oral argument and certiorari form workflows by procedural posture', () => {
    const active = createInitialSession()
    const activeEvents = getAvailableEcfEventDefinitions(active)

    expect(
      activeEvents.find((event) => event.eventId === 'oral_argument_acknowledgment')
        ?.available,
    ).toBe(false)
    expect(activeEvents.find((event) => event.eventId === 'certiorari_status_form')?.available).toBe(false)

    const closed = { ...active, status: 'closed' as const }
    const closedEvents = getAvailableEcfEventDefinitions(closed)

    expect(closedEvents.find((event) => event.eventId === 'certiorari_status_form')?.available).toBe(true)
    expect(
      closedEvents.find((event) => event.eventId === 'oral_argument_acknowledgment')
        ?.available,
    ).toBe(false)
  })

  it('fails motion events before rule preflight when relief text is missing', () => {
    const session = createInitialSession()
    const result = preflightEcfFiling(session, submission('motion', motionPdf))

    expect(result.accepted).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('ecf_motion_relief_missing')
  })

  it('requires related docket entry selection for response-style events', () => {
    let session = createInitialSession()
    session = fileDraft(session, draft('notice_of_appeal', noticePdf))
    const result = preflightEcfFiling(
      session,
      submission('motion_response', {
        ...motionPdf,
        extractedText: 'Response to motion.',
        extractedSignals: ['response'],
      }),
    )

    expect(result.accepted).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain(
      'ecf_related_docket_entry_missing',
    )
  })

  it('requires sealed type and privacy acknowledgement for sealed filings', () => {
    const session = createInitialSession()
    const sealed = {
      ...submission('motion_to_seal', motionPdf),
      metadata: {
        ...defaultFilingMetadata('motion_to_seal', true),
        representedPartyId: 'appellant',
        reliefRequested: 'Seal confidential material.',
        sealedDocumentType: '',
        privacyAcknowledged: false,
        redactionAcknowledged: false,
        publicRedactedVersionIncluded: true,
      },
    }
    const issues = validateEcfWizardCompleteness(session, sealed)

    expect(issues.map((issue) => issue.code)).toContain('ecf_sealed_document_type_missing')
    expect(issues.map((issue) => issue.code)).toContain('ecf_privacy_acknowledgment_missing')
  })

  it('generates service lists with CM/ECF overrides', () => {
    const session = createInitialSession()
    const recipients = serviceRecipientsForSubmission(session, {
      ...submission('notice_of_appeal', noticePdf),
      metadata: {
        ...defaultFilingMetadata('notice_of_appeal'),
        representedPartyId: 'appellant',
        serviceListOverrides: {
          suppressedParticipantIds: ['appellee'],
          additionalRecipients: ['records@example.test'],
        },
      },
    })

    expect(recipients).toContain('Maya Jordan')
    expect(recipients).toContain('records@example.test')
    expect(recipients).not.toContain('Meridian Analytics, Inc.')
  })

  it('builds NODA preview with docket text, filing id, documents, and service recipients', () => {
    const session = createInitialSession()
    const preview = buildNoticeOfDocketActivityPreview(
      session,
      submission('notice_of_appeal', noticePdf),
    )

    expect(preview.receiptNumber).toContain('CA4-')
    expect(preview.docketText).toContain('Filing ID: preview')
    expect(preview.docketText).toContain('Service')
    expect(preview.recipients).toContain('Maya Jordan')
  })

  it('creates receipts with next expected deadline after accepted filing', () => {
    const session = createInitialSession()
    const result = submitEcfFiling(session, submission('notice_of_appeal', noticePdf))

    expect(result.preflight.accepted).toBe(true)
    expect(result.receipt?.documentList?.[0]?.fileName).toBe('notice-of-appeal.pdf')
    expect(result.receipt?.serviceList).toContain('Maya Jordan')
    expect(result.receipt?.nextExpectedDeadline?.targetEventId).toBe('appearance_disclosure')
  })
})
