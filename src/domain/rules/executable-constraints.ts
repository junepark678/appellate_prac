import { getCourtPack, getFilingEvent, ruleRefs } from '../../modules/registry'
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
  return [document.fileName, document.extractedText, ...document.extractedSignals]
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
    ...sequenceIssues(session, submission),
  ]
  const outcome = outcomeForIssues(issues)

  return {
    accepted: outcome !== 'rejected',
    outcome,
    issues,
    analyzedAt: nowIso,
  }
}

