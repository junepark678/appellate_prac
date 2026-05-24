import { fileDraft } from '../simulation'
import type {
  CaseSession,
  EcfReceipt,
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
    docketText: `${submission.title} filed by ${submission.participantRole.replaceAll('_', ' ')}. Filing ID: ${filingId}.`,
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
  return {
    id: `receipt_${notice.receiptNumber.toLowerCase()}`,
    caseSessionId: session.id,
    filingId,
    receiptNumber: notice.receiptNumber,
    noticeOfDocketActivityText: notice.docketText,
    serviceList: notice.recipients,
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
    session: nextSession,
    receipt,
  }
}

