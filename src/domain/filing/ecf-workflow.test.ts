import { describe, expect, it } from 'vitest'

import { createInitialSession, fileDraft } from '../simulation'
import type { FilingDraft, FilingSubmission, UploadedDocument } from '../types'
import {
  buildNoticeOfDocketActivityPreview,
  defaultFilingMetadata,
  preflightEcfFiling,
  serviceRecipientsForSubmission,
  submitEcfFiling,
  validateEcfWizardCompleteness,
} from './ecf'

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

