import { fileDraft } from '../simulation'
import type {
  CaseSession,
  EcfEventCategory,
  EcfEventDefinition,
  EcfReceipt,
  FilingEvent,
  FilingDraft,
  FilingMetadata,
  FilingSubmission,
  NoticeOfDocketActivity,
  PreflightCheckResult,
  UploadedDocument,
} from '../types'
import { preflightFilingSubmission } from '../rules/executable-constraints'

export function defaultFilingMetadata(eventId: string, sealed = false): FilingMetadata {
  return {
    serviceMethod: 'cm_ecf',
    emergency: false,
    sealed,
    redactionAcknowledged: !sealed,
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    ...(eventId.includes('amicus') ? { consentStatus: 'unknown' as const } : {}),
    ...(sealed ? { sealedDocumentType: 'sealed material' } : {}),
  }
}

export function filingDraftToSubmission(draft: FilingDraft): FilingSubmission | null {
  const [mainDocument, ...attachmentDocuments] = draft.documents
  if (!mainDocument) return null

  return {
    eventId: draft.eventId,
    participantRole: draft.participantRole,
    title: draft.title,
    mainDocument,
    attachments: attachmentDocuments.map((document, index) => ({
      id: `attachment_${index + 1}`,
      label: document.fileName,
      document,
      attachmentType: draft.eventId === 'joint_appendix' ? 'appendix' : 'other',
    })),
    metadata: {
      ...defaultFilingMetadata(draft.eventId, draft.sealed),
      certificateOfService: draft.certificateOfService,
      certificateOfCompliance: draft.certificateOfCompliance,
    },
    notes: draft.notes,
  }
}

export function filingSubmissionToDraft(submission: FilingSubmission): FilingDraft {
  const documents: UploadedDocument[] = [
    submission.mainDocument,
    ...submission.attachments.map((attachment) => attachment.document),
  ]

  return {
    eventId: submission.eventId,
    participantRole: submission.participantRole,
    title: submission.title,
    documents,
    certificateOfService: submission.metadata.certificateOfService,
    certificateOfCompliance: submission.metadata.certificateOfCompliance,
    sealed: submission.metadata.sealed,
    notes: submission.notes,
  }
}

function receiptNumber(session: CaseSession, filingCount: number) {
  const datePart = session.simulatedDate.slice(0, 10).replaceAll('-', '')
  return `CA4-${datePart}-${String(filingCount + 1).padStart(5, '0')}`
}

function categoryForEvent(eventId: string): EcfEventCategory {
  if (eventId === 'notice_of_appeal') return 'case_opening'
  if (eventId === 'appearance_disclosure') return 'appearance'
  if (eventId.includes('appendix')) return 'appendix'
  if (eventId.includes('brief') || eventId === 'corrected_brief') return 'brief'
  if (eventId.includes('response')) return 'response'
  if (eventId.includes('seal')) return 'sealed'
  if (eventId.includes('amicus')) return 'amicus'
  if (eventId.includes('rehearing') || eventId.includes('mandate')) return 'post_disposition'
  return 'motion'
}

export function ecfEventDefinitionFromFilingEvent(event: FilingEvent): EcfEventDefinition {
  const isBrief = event.id.includes('brief') || event.id === 'corrected_brief'
  const isMotion = event.id.includes('motion') || event.id === 'motion'
  const isSealed = event.id.includes('seal')
  const isCaseOpening = event.id === 'notice_of_appeal'

  return {
    eventId: event.id,
    category: categoryForEvent(event.id),
    displayName: event.label,
    eligibleRoles: event.allowedParticipantRoles,
    requiresMainDocument: event.requiredDocuments.length > 0,
    requiredAttachments: event.requiredDocuments.slice(1).map((requirement) => requirement.label),
    optionalAttachments: event.optionalDocuments.map((requirement) => requirement.label),
    metadataFields: [
      {
        key: 'representedPartyId',
        label: 'Represented party',
        inputType: 'text',
        required: false,
      },
      {
        key: 'reliefRequested',
        label: 'Relief requested',
        inputType: 'text',
        required: isMotion,
      },
      {
        key: 'relatedDocketEntryId',
        label: 'Related docket entry',
        inputType: 'docket_entry_ref',
        required: event.id.includes('response') || event.id === 'corrected_brief',
      },
      {
        key: 'certificateOfService',
        label: 'Certificate of service',
        inputType: 'checkbox',
        required: true,
      },
      {
        key: 'certificateOfCompliance',
        label: 'Certificate of compliance',
        inputType: 'checkbox',
        required: isBrief,
      },
      {
        key: 'sealed',
        label: 'Sealed filing',
        inputType: 'checkbox',
        required: isSealed,
      },
      ...(event.id.includes('amicus')
        ? [
            {
              key: 'consentStatus',
              label: 'Consent status',
              inputType: 'select' as const,
              required: true,
              options: [
                'all_parties_consent',
                'partial_consent',
                'no_consent',
                'unknown',
              ],
            },
          ]
        : []),
    ],
    feeBehavior: isCaseOpening ? 'required' : event.id.includes('ifp') ? 'waivable' : 'none',
    serviceBehavior: event.allowedParticipantRoles.includes('amicus') ? 'mixed' : 'cm_ecf',
  }
}

function allDocuments(submission: FilingSubmission) {
  return [
    { document: submission.mainDocument, attachmentType: 'main' as const },
    ...submission.attachments.map((attachment) => ({
      document: attachment.document,
      attachmentType: attachment.attachmentType,
    })),
  ]
}

function nextOpenDeadline(session: CaseSession) {
  return session.deadlines
    .filter((deadline) => deadline.status === 'open')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}

export function createNoticeOfDocketActivity(
  session: CaseSession,
  submission: FilingSubmission,
  filingId: string,
): NoticeOfDocketActivity {
  const recipients = session.participants
    .filter((participant) => ['appellant', 'appellee', 'amicus'].includes(participant.role))
    .map((participant) => participant.displayName)

  return {
    receiptNumber: receiptNumber(session, session.filings.length),
    docketText: `${submission.title} filed by ${submission.participantRole.replaceAll('_', ' ')}. Filing ID: ${filingId}. Service: ${submission.metadata.serviceMethod.replaceAll('_', ' ')}.`,
    recipients,
    generatedAt: session.simulatedDate,
  }
}

export function createEcfReceipt(
  session: CaseSession,
  submission: FilingSubmission,
  filingId: string,
): EcfReceipt {
  const notice = createNoticeOfDocketActivity(session, submission, filingId)
  const openDeadline = nextOpenDeadline(session)
  const warnings = session.filings
    .find((filing) => filing.id === filingId)
    ?.validationIssues.filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message) ?? []
  const deficiencies = session.filings
    .find((filing) => filing.id === filingId)
    ?.validationIssues.filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message) ?? []

  return {
    id: `receipt_${notice.receiptNumber.toLowerCase()}`,
    caseSessionId: session.id,
    filingId,
    receiptNumber: notice.receiptNumber,
    filedTimestamp: notice.generatedAt,
    filer: submission.participantRole,
    eventId: submission.eventId,
    documentList: allDocuments(submission).map(({ document, attachmentType }) => ({
      fileName: document.fileName,
      attachmentType,
      sizeBytes: document.sizeBytes,
    })),
    noticeOfDocketActivityText: notice.docketText,
    serviceList: notice.recipients,
    docketText: notice.docketText,
    warnings,
    deficiencies,
    ...(openDeadline
      ? {
          nextExpectedDeadline: {
            label: openDeadline.label,
            dueDate: openDeadline.dueDate,
            targetEventId: openDeadline.targetEventId,
          },
        }
      : {}),
    createdAt: notice.generatedAt,
  }
}

export type EcfSubmissionResult = {
  preflight: PreflightCheckResult
  session: CaseSession
  receipt: EcfReceipt | null
}

export function submitEcfFiling(
  session: CaseSession,
  submission: FilingSubmission,
): EcfSubmissionResult {
  const preflight = preflightFilingSubmission(session, submission, session.simulatedDate)
  const draft = filingSubmissionToDraft(submission)
  const nextSession = fileDraft(session, draft)
  const newestFiling = nextSession.filings.at(-1)
  const receipt =
    preflight.accepted && newestFiling
      ? createEcfReceipt(nextSession, submission, newestFiling.id)
      : null

  return {
    preflight,
    session: receipt
      ? {
          ...nextSession,
          ecfReceipts: [...(nextSession.ecfReceipts ?? []), receipt],
        }
      : nextSession,
    receipt,
  }
}
