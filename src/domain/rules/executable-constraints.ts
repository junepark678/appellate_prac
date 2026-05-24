import { getCourtPack, getFilingEvent, ruleRefs } from '../../modules/registry'
import { validateAmicusSubmission } from '../amicus/workflow'
import { briefAnalysisIssues } from '../documents/brief-analysis'
import type {
  CaseSession,
  FilingMetadata,
  FilingOutcome,
  FilingSubmission,
  PreflightCheckResult,
  RuleRef,
  UploadedDocument,
  ValidationIssue,
} from '../types'

const pdfSizeWarningBytes = 25 * 1024 * 1024

function allSubmissionDocuments(submission: FilingSubmission) {
  return [
    submission.mainDocument,
    ...submission.attachments.map((attachment) => attachment.document),
  ]
}

function documentText(document: UploadedDocument) {
  return [
    document.fileName,
    document.analysis?.normalizedText,
    document.extractedText,
    ...(document.analysis?.sectionMap?.map((section) => section.label) ?? []),
    ...(document.analysis?.recordCitations ?? []),
    ...(document.analysis?.appendixCitations ?? []),
    ...document.extractedSignals,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function hasSignal(document: UploadedDocument, signal: string) {
  return documentText(document).includes(signal.toLowerCase())
}

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  ruleRefsForIssue: RuleRef[],
  cureSuggestion: string,
): ValidationIssue {
  return {
    severity,
    code,
    message,
    ruleRefs: ruleRefsForIssue,
    cureSuggestion,
  }
}

function outcomeForIssues(issues: ValidationIssue[]): FilingOutcome {
  if (issues.some((candidate) => candidate.severity === 'error')) return 'rejected'
  if (issues.some((candidate) => candidate.severity === 'warning')) {
    return 'accepted_with_deficiency'
  }
  return 'accepted'
}

function serviceIssues(metadata: FilingMetadata) {
  if (metadata.certificateOfService) return []
  return [
    issue(
      'error',
      'certificate_of_service_missing',
      'Certificate of service is missing from the filing metadata.',
      [ruleRefs.frap25],
      'Include a certificate of service or select the correct service method before filing.',
    ),
  ]
}

function privacyIssues(submission: FilingSubmission) {
  const documents = allSubmissionDocuments(submission)
  const sealedSignal = documents.some((document) =>
    ['sealed', 'redacted', 'confidential', 'minor', 'ssn', 'social security'].some(
      (signal) => hasSignal(document, signal),
    ),
  )

  if (!sealedSignal || submission.metadata.redactionAcknowledged) return []
  return [
    issue(
      'warning',
      'privacy_redaction_acknowledgment_missing',
      'The document metadata suggests sealed, redacted, confidential, or personal-identifier material, but redaction responsibility was not acknowledged.',
      [ruleRefs.frap25],
      'Acknowledge redaction responsibility and confirm whether the filing should be sealed.',
    ),
  ]
}

function briefCertificateIssues(submission: FilingSubmission) {
  if (!['opening_brief', 'appellee_brief', 'reply_brief', 'amicus_brief'].includes(submission.eventId)) {
    return []
  }

  if (submission.metadata.certificateOfCompliance) return []
  return [
    issue(
      'error',
      'certificate_of_compliance_missing',
      'Certificate of compliance is missing for this brief.',
      [ruleRefs.frap32],
      'Attach or certify the required word/page compliance certificate before filing the brief.',
    ),
  ]
}

function sealedFilingIssues(submission: FilingSubmission) {
  if (!submission.metadata.sealed && !submission.eventId.includes('seal')) return []

  const issues: ValidationIssue[] = []
  if (!submission.metadata.redactionAcknowledged) {
    issues.push(
      issue(
        'error',
        'sealed_redaction_acknowledgment_missing',
        'Sealed filings require a redaction and sealing acknowledgement.',
        [ruleRefs.frap25],
        'Acknowledge redaction responsibility and confirm the sealed filing metadata.',
      ),
    )
  }

  if (submission.metadata.sealed && !submission.metadata.sealedDocumentType) {
    issues.push(
      issue(
        'warning',
        'sealed_document_type_missing',
        'Sealed filing metadata does not identify the sealed document type.',
        [ruleRefs.frap25],
        'Identify whether the upload is sealed material, a public redacted copy, or a sealing motion.',
      ),
    )
  }

  return issues
}

function metadataIssues(submission: FilingSubmission) {
  const issues: ValidationIssue[] = []

  if (
    ['motion', 'motion_extend_time', 'motion_overlength_brief', 'motion_to_seal', 'mandate_stay_motion'].includes(
      submission.eventId,
    ) &&
    !submission.metadata.reliefRequested?.trim()
  ) {
    issues.push(
      issue(
        'warning',
        'motion_relief_metadata_missing',
        'Motion metadata does not identify the relief requested.',
        [ruleRefs.frap27],
        'Enter the requested relief in the event metadata before final filing.',
      ),
    )
  }

  if (
    ['motion_response', 'response_to_amicus_motion', 'corrected_brief'].includes(submission.eventId) &&
    !submission.metadata.relatedDocketEntryId
  ) {
    issues.push(
      issue(
        'warning',
        'related_docket_entry_missing',
        'The event metadata does not identify the related docket entry.',
        [ruleRefs.frap25, ruleRefs.frap27],
        'Select the motion, deficiency notice, or docket entry this filing responds to.',
      ),
    )
  }

  return issues
}

function sequenceIssues(session: CaseSession, submission: FilingSubmission) {
  const filedEvents = new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
  const issues: ValidationIssue[] = []

  if (submission.eventId === 'opening_brief' && !filedEvents.has('appearance_disclosure')) {
    issues.push(
      issue(
        'warning',
        'opening_brief_before_appearance',
        'Opening brief is being filed before an appellant appearance/disclosure statement appears on the docket.',
        [ruleRefs.frap26_1, ruleRefs.ca4Local12],
        'File the appearance/disclosure statement before merits briefing when possible.',
      ),
    )
  }

  if (submission.eventId === 'reply_brief' && !filedEvents.has('appellee_brief')) {
    issues.push(
      issue(
        'error',
        'reply_before_appellee_brief',
        'A reply brief cannot precede the appellee brief.',
        [ruleRefs.frap31],
        'Wait for the appellee brief before submitting a reply brief.',
      ),
    )
  }

  if (submission.eventId === 'appellee_brief' && !filedEvents.has('opening_brief')) {
    issues.push(
      issue(
        'error',
        'appellee_brief_before_opening_brief',
        'An appellee brief cannot be filed before the appellant opening brief.',
        [ruleRefs.frap31],
        'Wait for the opening brief and appendix posture before filing the appellee brief.',
      ),
    )
  }

  if (submission.eventId === 'appellee_brief' && !filedEvents.has('joint_appendix')) {
    issues.push(
      issue(
        'warning',
        'appellee_brief_before_appendix',
        'The appellee brief is being filed before the joint appendix appears on the docket.',
        [ruleRefs.frap30, ruleRefs.frap31],
        'Confirm the appendix posture before appellee briefing.',
      ),
    )
  }

  if (session.status === 'closed' && submission.eventId !== 'petition_rehearing') {
    issues.push(
      issue(
        'error',
        'post_closure_event_unavailable',
        'Only authorized post-disposition filings are available after closure.',
        [ruleRefs.frap40, ruleRefs.frap41],
        'Use a rehearing or mandate-related event if it is available in the current posture.',
      ),
    )
  }

  return issues
}

function deadlineIssues(
  session: CaseSession,
  submission: FilingSubmission,
  nowIso: string,
) {
  const deadline = session.deadlines.find(
    (candidate) =>
      candidate.targetEventId === submission.eventId && candidate.status === 'open',
  )
  if (!deadline || new Date(nowIso) <= new Date(deadline.dueDate)) return []

  return [
    issue(
      'warning',
      'filing_after_open_deadline',
      `${submission.title} appears after the open simulator deadline.`,
      deadline.sourceRuleRefs,
      'File a motion to extend time or explain timeliness if the deadline has expired.',
    ),
  ]
}

function documentRequirementIssues(session: CaseSession, submission: FilingSubmission) {
  const event = getFilingEvent(session.courtPackId, submission.eventId)
  if (!event) {
    return [
      issue(
        'error',
        'unknown_filing_event',
        'The selected filing event is not available in this court pack.',
        [],
        'Select a filing event published by the current court pack.',
      ),
    ]
  }

  const documents = allSubmissionDocuments(submission)
  const issues: ValidationIssue[] = []
  const remainingDocuments = [...documents]

  for (const requirement of event.requiredDocuments) {
    const matchingIndex = remainingDocuments.findIndex((document) =>
      requirement.acceptedMimeTypes.includes(document.mimeType),
    )
    const matchingDocument =
      matchingIndex >= 0 ? remainingDocuments.splice(matchingIndex, 1)[0] : undefined

    if (!matchingDocument) {
      issues.push(
        issue(
          'error',
          `required_document_${requirement.id}_missing`,
          `${requirement.label} is required.`,
          event.validationRuleRefs,
          `Attach the required ${requirement.label.toLowerCase()} as a PDF.`,
        ),
      )
      continue
    }

    if (matchingDocument.sizeBytes > pdfSizeWarningBytes) {
      issues.push(
        issue(
          'warning',
          'pdf_size_warning',
          `${matchingDocument.fileName} is large enough that a real filing system may require extra handling.`,
          [ruleRefs.frap25],
          'Compress or split the PDF if the court event requires a smaller upload.',
        ),
      )
    }

    if (
      typeof requirement.maxPages === 'number' &&
      typeof matchingDocument.pageCount === 'number' &&
      matchingDocument.pageCount > requirement.maxPages
    ) {
      issues.push(
        issue(
          'error',
          `page_limit_${requirement.id}_exceeded`,
          `${matchingDocument.fileName} exceeds the ${requirement.maxPages}-page simulator limit for ${requirement.label}.`,
          event.validationRuleRefs,
          `Reduce the filing to ${requirement.maxPages} pages or use the correct filing event.`,
        ),
      )
    }

    for (const signal of requirement.mustContain ?? []) {
      if (!hasSignal(matchingDocument, signal)) {
        issues.push(
          issue(
            'warning',
            `brief_content_signal_${signal.replaceAll(' ', '_')}_missing`,
            `${requirement.label} does not show a "${signal}" signal in searchable text or metadata.`,
            event.validationRuleRefs,
            `Confirm the document includes the required ${signal} content.`,
          ),
        )
      }
    }
  }

  return issues
}

function roleAndCourtIssues(session: CaseSession, submission: FilingSubmission) {
  const courtPack = getCourtPack(session.courtPackId)
  const event = getFilingEvent(session.courtPackId, submission.eventId)
  if (!event) return []
  const issues: ValidationIssue[] = []

  if (!event.allowedCourtLevels.includes(courtPack.courtLevel)) {
    issues.push(
      issue(
        'error',
        'court_level_event_unavailable',
        `${event.label} is not available at this court level.`,
        event.validationRuleRefs,
        'Select an event available in this appellate court pack.',
      ),
    )
  }

  if (!event.allowedParticipantRoles.includes(submission.participantRole)) {
    issues.push(
      issue(
        'error',
        'participant_role_event_unavailable',
        `${submission.participantRole.replaceAll('_', ' ')} cannot file ${event.label} in this posture.`,
        event.validationRuleRefs,
        'Confirm the filer role and represented party before submitting.',
      ),
    )
  }

  return issues
}

function legalRealismIssues(submission: FilingSubmission) {
  const hasDocumentAnalysis = allSubmissionDocuments(submission).some(
    (document) => document.analysis || document.analysisId || document.textExtractionStatus,
  )
  if (hasDocumentAnalysis) return []

  const text = allSubmissionDocuments(submission)
    .map(documentText)
    .join(' ')
  const issues: ValidationIssue[] = []

  if (submission.eventId === 'opening_brief' && !text.includes('standard of review')) {
    issues.push(
      issue(
        'warning',
        'standard_of_review_missing',
        'Opening brief does not show a standard-of-review signal.',
        [ruleRefs.frap28, ruleRefs.ca4Local28],
        'Add a standard-of-review section for each issue.',
      ),
    )
  }

  if (
    ['opening_brief', 'reply_brief', 'appellee_brief'].includes(submission.eventId) &&
    !text.includes('record citation')
  ) {
    issues.push(
      issue(
        'warning',
        'record_citations_missing',
        'Brief does not show a record-citation signal.',
        [ruleRefs.frap28, ruleRefs.ca4Local28],
        'Add record citations tied to the joint appendix or record excerpts.',
      ),
    )
  }

  if (
    submission.eventId === 'opening_brief' &&
    typeof submission.mainDocument.pageCount === 'number' &&
    submission.mainDocument.pageCount > 65
  ) {
    issues.push(
      issue(
        'warning',
        'potential_overlength_brief',
        'Opening brief page count suggests overlength briefing may require leave.',
        [ruleRefs.frap32, ruleRefs.ca4Local28],
        'File a motion to file an overlength brief if the brief exceeds applicable limits.',
      ),
    )
  }

  return issues
}

export function preflightFilingSubmission(
  session: CaseSession,
  submission: FilingSubmission,
  nowIso = new Date().toISOString(),
): PreflightCheckResult {
  const issues = [
    ...roleAndCourtIssues(session, submission),
    ...documentRequirementIssues(session, submission),
    ...serviceIssues(submission.metadata),
    ...briefCertificateIssues(submission),
    ...privacyIssues(submission),
    ...sealedFilingIssues(submission),
    ...metadataIssues(submission),
    ...sequenceIssues(session, submission),
    ...deadlineIssues(session, submission, nowIso),
    ...validateAmicusSubmission(session, submission),
    ...briefAnalysisIssues(session, submission),
    ...legalRealismIssues(submission),
  ]
  const outcome = outcomeForIssues(issues)

  return {
    accepted: outcome !== 'rejected',
    outcome,
    issues,
    analyzedAt: nowIso,
  }
}
