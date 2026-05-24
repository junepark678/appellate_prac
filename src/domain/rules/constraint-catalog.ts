import { getCourtPack, getFilingEvent, ruleRefs } from '../../modules/registry'
import { validateAmicusSubmission } from '../amicus/workflow'
import { briefAnalysisIssues } from '../documents/brief-analysis'
import type {
  CaseSession,
  FilingMetadata,
  FilingOutcome,
  FilingSubmission,
  ParticipantRole,
  PreflightCheckResult,
  RuleRef,
  UploadedDocument,
  ValidationIssue,
} from '../types'

export type ConstraintContext = {
  session: CaseSession
  submission: FilingSubmission
  nowIso: string
}

export type FilingConstraint = {
  id: string
  source: 'frap' | 'ca4-local' | 'simulator'
  ruleRefs: RuleRef[]
  eventIds?: string[]
  participantRoles?: ParticipantRole[]
  severity: ValidationIssue['severity']
  evaluate: (context: ConstraintContext) => ValidationIssue | null
}

const pdfSizeWarningBytes = 25 * 1024 * 1024
const meritsBriefEvents = ['opening_brief', 'appellee_brief', 'reply_brief']
const briefEvents = [...meritsBriefEvents, 'amicus_brief', 'corrected_brief']
const motionEvents = [
  'motion',
  'motion_extend_time',
  'motion_overlength_brief',
  'motion_to_seal',
  'motion_stay_pending_appeal',
  'mandate_stay_motion',
]

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

function submissionText(submission: FilingSubmission) {
  return [
    submission.title,
    submission.notes,
    ...allSubmissionDocuments(submission).map(documentText),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function hasSignal(document: UploadedDocument, signal: string) {
  return documentText(document).includes(signal.toLowerCase())
}

function filedEvents(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

function latestAcceptedFilingText(session: CaseSession, eventId: string) {
  const filing = session.filings
    .filter((candidate) => candidate.eventId === eventId && candidate.outcome !== 'rejected')
    .at(-1)
  return filing?.documents.map(documentText).join(' ') ?? ''
}

export function validationIssue(
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

function eventFor(context: ConstraintContext) {
  return getFilingEvent(context.session.courtPackId, context.submission.eventId)
}

function filedTextHas(context: ConstraintContext, values: string[]) {
  const text = submissionText(context.submission)
  return values.some((value) => text.includes(value.toLowerCase()))
}

function serviceIssue(metadata: FilingMetadata) {
  if (metadata.certificateOfService) return null
  return validationIssue(
    'error',
    'certificate_of_service_missing',
    'Certificate of service is missing from the filing metadata.',
    [ruleRefs.frap25, ruleRefs.ca4Local25],
    'Include a certificate of service or select the correct service method before filing.',
  )
}

function scenarioHasPitfall(session: CaseSession, needles: string[]) {
  const text = [
    session.scenario.id,
    session.scenario.proceduralPosture,
    ...(session.scenario.training?.modeledPitfalls ?? []),
    ...session.scenario.issuesPresented,
    ...(session.scenario.issues?.map((issue) => issue.id) ?? []),
  ]
    .join(' ')
    .toLowerCase()

  return needles.some((needle) => text.includes(needle.toLowerCase()))
}

export function sessionJurisdictionIssues(session: CaseSession): ValidationIssue[] {
  const events = filedEvents(session)
  const issues: ValidationIssue[] = []

  if (!events.has('notice_of_appeal')) {
    issues.push(
      validationIssue(
        'error',
        'notice_of_appeal_missing_jurisdiction',
        'The case lacks a filed notice of appeal, so merits disposition is unavailable.',
        [ruleRefs.frap3, ruleRefs.frap4],
        'File a valid notice of appeal before requesting appellate merits relief.',
      ),
    )
  }

  if (scenarioHasPitfall(session, ['rule 54', 'finality without rule 54', 'partial judgment'])) {
    const cured = session.docketEntries.some((entry) =>
      /rule 54\(b\)|final judgment|certification/i.test(`${entry.title} ${entry.text}`),
    )
    if (!cured) {
      issues.push(
        validationIssue(
          'error',
          'rule54_finality_jurisdiction_defect',
          'The scenario record shows a partial judgment with unresolved claims and no Rule 54(b) or final-judgment cure.',
          [ruleRefs.frap3, ruleRefs.frap4, ruleRefs.ca4Local3],
          'Address appellate jurisdiction through a show-cause response, dismissal, abeyance, or a district-court certification/final-judgment cure.',
        ),
      )
    }
  }

  if (scenarioHasPitfall(session, ['interlocutory jurisdiction limited to legal questions'])) {
    const openingText = latestAcceptedFilingText(session, 'opening_brief')
    if (openingText.includes('disputed fact') || openingText.includes('facts are disputed')) {
      issues.push(
        validationIssue(
          'warning',
          'qualified_immunity_fact_bound_jurisdiction',
          'The qualified-immunity posture permits legal-question review but not ordinary fact-bound appellate relitigation.',
          [ruleRefs.frap3],
          'Frame relief around the legal question accepted on the assumed facts or seek dismissal/remand of fact-bound portions.',
        ),
      )
    }
  }

  return issues
}

export const filingConstraints: FilingConstraint[] = [
  {
    id: 'event_exists',
    source: 'simulator',
    ruleRefs: [],
    severity: 'error',
    evaluate(context) {
      if (eventFor(context)) return null
      return validationIssue(
        'error',
        'unknown_filing_event',
        'The selected filing event is not available in this court pack.',
        [],
        'Select a filing event published by the current court pack.',
      )
    },
  },
  {
    id: 'court_level_allowed',
    source: 'simulator',
    ruleRefs: [],
    severity: 'error',
    evaluate(context) {
      const event = eventFor(context)
      if (!event) return null
      const courtPack = getCourtPack(context.session.courtPackId)
      if (event.allowedCourtLevels.includes(courtPack.courtLevel)) return null
      return validationIssue(
        'error',
        'court_level_event_unavailable',
        `${event.label} is not available at this court level.`,
        event.validationRuleRefs,
        'Select an event available in this appellate court pack.',
      )
    },
  },
  {
    id: 'participant_role_allowed',
    source: 'simulator',
    ruleRefs: [],
    severity: 'error',
    evaluate(context) {
      const event = eventFor(context)
      if (!event) return null
      if (event.allowedParticipantRoles.includes(context.submission.participantRole)) return null
      return validationIssue(
        'error',
        'participant_role_event_unavailable',
        `${context.submission.participantRole.replaceAll('_', ' ')} cannot file ${event.label} in this posture.`,
        event.validationRuleRefs,
        'Confirm the filer role and represented party before submitting.',
      )
    },
  },
  {
    id: 'required_document_present',
    source: 'simulator',
    ruleRefs: [],
    severity: 'error',
    evaluate(context) {
      const event = eventFor(context)
      if (!event) return null
      const documents = allSubmissionDocuments(context.submission)
      for (const requirement of event.requiredDocuments) {
        const matchingDocument = documents.find((document) =>
          requirement.acceptedMimeTypes.includes(document.mimeType),
        )
        if (!matchingDocument) {
          return validationIssue(
            'error',
            `required_document_${requirement.id}_missing`,
            `${requirement.label} is required.`,
            event.validationRuleRefs,
            `Attach the required ${requirement.label.toLowerCase()} as a PDF.`,
          )
        }
      }
      return null
    },
  },
  {
    id: 'pdf_size_warning',
    source: 'frap',
    ruleRefs: [ruleRefs.frap25, ruleRefs.ca4Local25],
    severity: 'warning',
    evaluate(context) {
      const largeDocument = allSubmissionDocuments(context.submission).find(
        (document) => document.sizeBytes > pdfSizeWarningBytes,
      )
      if (!largeDocument) return null
      return validationIssue(
        'warning',
        'pdf_size_warning',
        `${largeDocument.fileName} is large enough that a real filing system may require extra handling.`,
        [ruleRefs.frap25, ruleRefs.ca4Local25],
        'Compress or split the PDF if the court event requires a smaller upload.',
      )
    },
  },
  {
    id: 'page_limit',
    source: 'frap',
    ruleRefs: [ruleRefs.frap32, ruleRefs.ca4Local32],
    severity: 'error',
    evaluate(context) {
      const event = eventFor(context)
      if (!event) return null
      const documents = allSubmissionDocuments(context.submission)
      for (const requirement of event.requiredDocuments) {
        const document = documents.find((candidate) =>
          requirement.acceptedMimeTypes.includes(candidate.mimeType),
        )
        if (
          document &&
          typeof requirement.maxPages === 'number' &&
          typeof document.pageCount === 'number' &&
          document.pageCount > requirement.maxPages
        ) {
          return validationIssue(
            'error',
            `page_limit_${requirement.id}_exceeded`,
            `${document.fileName} exceeds the ${requirement.maxPages}-page simulator limit for ${requirement.label}.`,
            event.validationRuleRefs,
            `Reduce the filing to ${requirement.maxPages} pages or use the correct filing event.`,
          )
        }
      }
      return null
    },
  },
  {
    id: 'document_content_signal',
    source: 'simulator',
    ruleRefs: [],
    severity: 'warning',
    evaluate(context) {
      const event = eventFor(context)
      if (!event) return null
      const documents = allSubmissionDocuments(context.submission)
      for (const requirement of event.requiredDocuments) {
        const document = documents.find((candidate) =>
          requirement.acceptedMimeTypes.includes(candidate.mimeType),
        )
        if (!document) continue
        const missingSignal = (requirement.mustContain ?? []).find(
          (signal) => !hasSignal(document, signal),
        )
        if (missingSignal) {
          return validationIssue(
            'warning',
            `brief_content_signal_${missingSignal.replaceAll(' ', '_')}_missing`,
            `${requirement.label} does not show a "${missingSignal}" signal in searchable text or metadata.`,
            event.validationRuleRefs,
            `Confirm the document includes the required ${missingSignal} content.`,
          )
        }
      }
      return null
    },
  },
  {
    id: 'service_certificate',
    source: 'frap',
    ruleRefs: [ruleRefs.frap25, ruleRefs.ca4Local25],
    severity: 'error',
    evaluate(context) {
      return serviceIssue(context.submission.metadata)
    },
  },
  {
    id: 'brief_compliance_certificate',
    source: 'frap',
    ruleRefs: [ruleRefs.frap32, ruleRefs.ca4Local32],
    eventIds: briefEvents,
    severity: 'error',
    evaluate(context) {
      if (!briefEvents.includes(context.submission.eventId)) return null
      if (context.submission.metadata.certificateOfCompliance) return null
      return validationIssue(
        'error',
        'certificate_of_compliance_missing',
        'Certificate of compliance is missing for this brief.',
        [ruleRefs.frap32, ruleRefs.ca4Local32],
        'Attach or certify the required word/page compliance certificate before filing the brief.',
      )
    },
  },
  {
    id: 'privacy_redaction_acknowledgment',
    source: 'frap',
    ruleRefs: [ruleRefs.frap25, ruleRefs.ca4Local25],
    severity: 'warning',
    evaluate(context) {
      const sealedSignal = allSubmissionDocuments(context.submission).some((document) =>
        ['sealed', 'redacted', 'confidential', 'minor', 'ssn', 'social security'].some(
          (signal) => hasSignal(document, signal),
        ),
      )
      if (!sealedSignal || context.submission.metadata.redactionAcknowledged) return null
      return validationIssue(
        'warning',
        'privacy_redaction_acknowledgment_missing',
        'The document metadata suggests sealed, redacted, confidential, or personal-identifier material, but redaction responsibility was not acknowledged.',
        [ruleRefs.frap25, ruleRefs.ca4Local25],
        'Acknowledge redaction responsibility and confirm whether the filing should be sealed.',
      )
    },
  },
  {
    id: 'sealed_redaction_acknowledgment',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.frap25, ruleRefs.ca4Local25],
    severity: 'error',
    evaluate(context) {
      if (!context.submission.metadata.sealed && !context.submission.eventId.includes('seal')) {
        return null
      }
      if (context.submission.metadata.redactionAcknowledged) return null
      return validationIssue(
        'error',
        'sealed_redaction_acknowledgment_missing',
        'Sealed filings require a redaction and sealing acknowledgement.',
        [ruleRefs.frap25, ruleRefs.ca4Local25],
        'Acknowledge redaction responsibility and confirm the sealed filing metadata.',
      )
    },
  },
  {
    id: 'sealed_document_type',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.frap25, ruleRefs.ca4Local25],
    severity: 'warning',
    evaluate(context) {
      if (!context.submission.metadata.sealed || context.submission.metadata.sealedDocumentType) {
        return null
      }
      return validationIssue(
        'warning',
        'sealed_document_type_missing',
        'Sealed filing metadata does not identify the sealed document type.',
        [ruleRefs.frap25, ruleRefs.ca4Local25],
        'Identify whether the upload is sealed material, a public redacted copy, or a sealing motion.',
      )
    },
  },
  {
    id: 'motion_relief_metadata',
    source: 'frap',
    ruleRefs: [ruleRefs.frap27, ruleRefs.ca4Local27],
    eventIds: motionEvents,
    severity: 'warning',
    evaluate(context) {
      if (!motionEvents.includes(context.submission.eventId)) return null
      if (context.submission.metadata.reliefRequested?.trim()) return null
      return validationIssue(
        'warning',
        'motion_relief_metadata_missing',
        'Motion metadata does not identify the relief requested.',
        [ruleRefs.frap27, ruleRefs.ca4Local27],
        'Enter the requested relief in the event metadata before final filing.',
      )
    },
  },
  {
    id: 'related_docket_entry',
    source: 'frap',
    ruleRefs: [ruleRefs.frap25, ruleRefs.frap27],
    eventIds: ['motion_response', 'response_to_amicus_motion', 'corrected_brief'],
    severity: 'warning',
    evaluate(context) {
      if (
        !['motion_response', 'response_to_amicus_motion', 'corrected_brief'].includes(
          context.submission.eventId,
        )
      ) {
        return null
      }
      if (context.submission.metadata.relatedDocketEntryId) return null
      return validationIssue(
        'warning',
        'related_docket_entry_missing',
        'The event metadata does not identify the related docket entry.',
        [ruleRefs.frap25, ruleRefs.frap27],
        'Select the motion, deficiency notice, or docket entry this filing responds to.',
      )
    },
  },
  {
    id: 'stay_district_court_first_signal',
    source: 'frap',
    ruleRefs: [ruleRefs.frap8, ruleRefs.ca4Local8, ruleRefs.ca4Local27],
    eventIds: ['motion_stay_pending_appeal'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'motion_stay_pending_appeal') return null
      if (
        context.submission.metadata.relatedDocketEntryId ||
        filedTextHas(context, ['district court first', 'district-court first', 'sought relief below', 'impracticable', 'district court denied stay'])
      ) {
        return null
      }
      return validationIssue(
        'warning',
        'stay_motion_district_court_first_missing',
        'Stay pending appeal papers do not show a district-court-first or impracticability signal.',
        [ruleRefs.frap8, ruleRefs.ca4Local8, ruleRefs.ca4Local27],
        'Explain the district-court stay request, attach the lower-court order, or state why seeking relief below is impracticable.',
      )
    },
  },
  {
    id: 'opening_brief_before_appearance',
    source: 'frap',
    ruleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
    eventIds: ['opening_brief'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'opening_brief') return null
      if (filedEvents(context.session).has('appearance_disclosure')) return null
      return validationIssue(
        'warning',
        'opening_brief_before_appearance',
        'Opening brief is being filed before an appellant appearance/disclosure statement appears on the docket.',
        [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
        'File the appearance/disclosure statement before merits briefing when possible.',
      )
    },
  },
  {
    id: 'opening_brief_before_docketing_statement',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.ca4Local3, ruleRefs.ca4Local45],
    eventIds: ['opening_brief'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'opening_brief') return null
      if (filedEvents(context.session).has('docketing_statement')) return null
      return validationIssue(
        'warning',
        'opening_brief_before_docketing_statement',
        'Opening brief is being filed before the Fourth Circuit docketing statement appears on the docket.',
        [ruleRefs.ca4Local3, ruleRefs.ca4Local45],
        'File the docketing statement or cure the opening-stage deficiency before merits scheduling.',
      )
    },
  },
  {
    id: 'opening_brief_before_transcript_ack',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.frap10, ruleRefs.ca4Local10, ruleRefs.ca4Local11],
    eventIds: ['opening_brief'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'opening_brief') return null
      if (filedEvents(context.session).has('transcript_order_acknowledgment')) return null
      return validationIssue(
        'warning',
        'opening_brief_before_transcript_acknowledgment',
        'Opening brief is being filed before transcript order acknowledgment appears on the docket.',
        [ruleRefs.frap10, ruleRefs.ca4Local10, ruleRefs.ca4Local11],
        'File the transcript order acknowledgment or identify why no transcript is necessary.',
      )
    },
  },
  {
    id: 'reply_after_appellee_brief',
    source: 'frap',
    ruleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
    eventIds: ['reply_brief'],
    severity: 'error',
    evaluate(context) {
      if (context.submission.eventId !== 'reply_brief') return null
      if (filedEvents(context.session).has('appellee_brief')) return null
      return validationIssue(
        'error',
        'reply_before_appellee_brief',
        'A reply brief cannot precede the appellee brief.',
        [ruleRefs.frap31, ruleRefs.ca4Local31],
        'Wait for the appellee brief before submitting a reply brief.',
      )
    },
  },
  {
    id: 'appellee_after_opening_brief',
    source: 'frap',
    ruleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
    eventIds: ['appellee_brief'],
    severity: 'error',
    evaluate(context) {
      if (context.submission.eventId !== 'appellee_brief') return null
      if (filedEvents(context.session).has('opening_brief')) return null
      return validationIssue(
        'error',
        'appellee_brief_before_opening_brief',
        'An appellee brief cannot be filed before the appellant opening brief.',
        [ruleRefs.frap31, ruleRefs.ca4Local31],
        'Wait for the opening brief and appendix posture before filing the appellee brief.',
      )
    },
  },
  {
    id: 'appellee_brief_before_appendix',
    source: 'frap',
    ruleRefs: [ruleRefs.frap30, ruleRefs.frap31, ruleRefs.ca4Local30],
    eventIds: ['appellee_brief'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'appellee_brief') return null
      if (filedEvents(context.session).has('joint_appendix')) return null
      return validationIssue(
        'warning',
        'appellee_brief_before_appendix',
        'The appellee brief is being filed before the joint appendix appears on the docket.',
        [ruleRefs.frap30, ruleRefs.frap31, ruleRefs.ca4Local30],
        'Confirm the appendix posture before appellee briefing.',
      )
    },
  },
  {
    id: 'notice_timeliness',
    source: 'frap',
    ruleRefs: [ruleRefs.frap4, ruleRefs.frap26],
    eventIds: ['notice_of_appeal'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'notice_of_appeal') return null
      const deadline = context.session.deadlines.find(
        (candidate) =>
          candidate.targetEventId === 'notice_of_appeal' && candidate.status === 'open',
      )
      if (!deadline || new Date(context.nowIso) <= new Date(deadline.dueDate)) return null
      return validationIssue(
        'warning',
        'notice_of_appeal_after_open_deadline',
        'The notice of appeal appears after the open simulator notice deadline.',
        deadline.sourceRuleRefs,
        'Confirm timeliness, tolling, or available extension/reopening relief before proceeding.',
      )
    },
  },
  {
    id: 'open_deadline_timeliness',
    source: 'frap',
    ruleRefs: [ruleRefs.frap26],
    severity: 'warning',
    evaluate(context) {
      const deadline = context.session.deadlines.find(
        (candidate) =>
          candidate.targetEventId === context.submission.eventId && candidate.status === 'open',
      )
      if (!deadline || new Date(context.nowIso) <= new Date(deadline.dueDate)) return null
      return validationIssue(
        'warning',
        'filing_after_open_deadline',
        `${context.submission.title} appears after the open simulator deadline.`,
        deadline.sourceRuleRefs,
        'File a motion to extend time or explain timeliness if the deadline has expired.',
      )
    },
  },
  {
    id: 'brief_required_sections',
    source: 'frap',
    ruleRefs: [ruleRefs.frap28, ruleRefs.ca4Local28],
    eventIds: meritsBriefEvents,
    severity: 'warning',
    evaluate(context) {
      if (!meritsBriefEvents.includes(context.submission.eventId)) return null
      if (allSubmissionDocuments(context.submission).some((document) => document.analysis)) return null
      const text = submissionText(context.submission)
      const requiredSignals = [
        ['jurisdiction', 'jurisdictional_statement_missing', 'jurisdictional statement'],
        ['statement of issues', 'issues_presented_missing', 'issues presented'],
        ['standard of review', 'standard_of_review_missing', 'standard of review'],
        ['argument', 'argument_section_missing', 'argument section'],
        ['conclusion', 'conclusion_relief_missing', 'conclusion stating relief'],
      ] as const
      const missing = requiredSignals.find(([signal]) => !text.includes(signal))
      if (!missing) return null
      return validationIssue(
        'warning',
        missing[1],
        `Brief does not show a ${missing[2]} signal.`,
        [ruleRefs.frap28, ruleRefs.ca4Local28],
        `Confirm the brief includes a ${missing[2]} with record-supported argument.`,
      )
    },
  },
  {
    id: 'brief_record_citations',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.frap28, ruleRefs.ca4Local28],
    eventIds: meritsBriefEvents,
    severity: 'warning',
    evaluate(context) {
      if (!meritsBriefEvents.includes(context.submission.eventId)) return null
      if (allSubmissionDocuments(context.submission).some((document) => document.analysis)) return null
      const text = submissionText(context.submission)
      if (text.includes('record citation') || text.includes('j.a.') || text.includes('ja ')) {
        return null
      }
      return validationIssue(
        'warning',
        'record_citations_missing',
        'Brief does not show a record-citation signal.',
        [ruleRefs.frap28, ruleRefs.ca4Local28],
        'Add record citations tied to the joint appendix or record excerpts.',
      )
    },
  },
  {
    id: 'brief_oral_argument_statement',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.frap34, ruleRefs.ca4Local34],
    eventIds: meritsBriefEvents,
    severity: 'warning',
    evaluate(context) {
      if (!meritsBriefEvents.includes(context.submission.eventId)) return null
      if (filedTextHas(context, ['oral argument', 'argument is unnecessary', 'submit on briefs'])) {
        return null
      }
      return validationIssue(
        'warning',
        'oral_argument_statement_missing',
        'Merits brief does not show an oral-argument statement signal.',
        [ruleRefs.frap34, ruleRefs.ca4Local34],
        'Add the statement regarding the need for oral argument or explain submission on the briefs.',
      )
    },
  },
  {
    id: 'potential_overlength_brief',
    source: 'frap',
    ruleRefs: [ruleRefs.frap32, ruleRefs.ca4Local32],
    eventIds: ['opening_brief'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'opening_brief') return null
      if (
        typeof context.submission.mainDocument.pageCount !== 'number' ||
        context.submission.mainDocument.pageCount <= 65
      ) {
        return null
      }
      return validationIssue(
        'warning',
        'potential_overlength_brief',
        'Opening brief page count suggests overlength briefing may require leave.',
        [ruleRefs.frap32, ruleRefs.ca4Local32],
        'File a motion to file an overlength brief if the brief exceeds applicable limits.',
      )
    },
  },
  {
    id: 'appendix_pagination',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    eventIds: ['joint_appendix'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'joint_appendix') return null
      if (filedTextHas(context, ['j.a.', 'ja ', 'pagination', 'appendix page'])) return null
      return validationIssue(
        'warning',
        'appendix_pagination_signal_missing',
        'Joint appendix does not show a pagination or appendix-citation signal.',
        [ruleRefs.frap30, ruleRefs.ca4Local30],
        'Confirm the appendix is paginated and usable for issue-specific record citations.',
      )
    },
  },
  {
    id: 'appendix_issue_support',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    eventIds: ['joint_appendix'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'joint_appendix') return null
      const text = submissionText(context.submission)
      const unsupportedIssue = context.session.scenario.issues?.find((issue) => {
        const issueText = [
          issue.id.replaceAll('-', ' '),
          issue.label,
          ...issue.recordSupportFacts,
          ...(context.session.scenario.recordExcerpts
            ?.filter((excerpt) => excerpt.citedByIssueIds.includes(issue.id))
            .map((excerpt) => excerpt.label) ?? []),
        ].join(' ').toLowerCase()
        return !issueText
          .split(/\s+/)
          .filter((token) => token.length > 5)
          .some((token) => text.includes(token))
      })
      if (!unsupportedIssue) return null
      return validationIssue(
        'warning',
        `appendix_support_${unsupportedIssue.id}_weak`,
        `Joint appendix does not show a strong record-support signal for ${unsupportedIssue.label}.`,
        [ruleRefs.frap30, ruleRefs.ca4Local30],
        'Add the record excerpts needed for each issue or explain why the material is unnecessary.',
      )
    },
  },
  {
    id: 'post_closure_event',
    source: 'frap',
    ruleRefs: [ruleRefs.frap36, ruleRefs.frap39, ruleRefs.frap40, ruleRefs.frap41],
    severity: 'error',
    evaluate(context) {
      if (context.session.status !== 'closed') return null
      if (['petition_rehearing', 'mandate_stay_motion', 'bill_of_costs'].includes(context.submission.eventId)) {
        return null
      }
      if (context.submission.eventId === 'rule_28j_letter') {
        return validationIssue(
          'error',
          'rule_28j_after_judgment',
          'A Rule 28(j) letter is not available after judgment has been entered.',
          [ruleRefs.frap28, ruleRefs.frap36, ruleRefs.ca4Local28],
          'Use a rehearing, costs, or mandate-related event if post-judgment relief is available.',
        )
      }
      return validationIssue(
        'error',
        'post_closure_event_unavailable',
        'Only authorized post-disposition filings are available after closure.',
        [ruleRefs.frap36, ruleRefs.frap40, ruleRefs.frap41],
        'Use a rehearing, costs, or mandate-related event if it is available in the current posture.',
      )
    },
  },
  {
    id: 'rehearing_after_judgment',
    source: 'frap',
    ruleRefs: [ruleRefs.frap40, ruleRefs.ca4Local40],
    eventIds: ['petition_rehearing'],
    severity: 'error',
    evaluate(context) {
      if (context.submission.eventId !== 'petition_rehearing') return null
      if (context.session.status === 'closed' || context.session.procedureState === 'judgment_entered') {
        return null
      }
      return validationIssue(
        'error',
        'rehearing_before_judgment',
        'A petition for rehearing is not available before judgment.',
        [ruleRefs.frap40, ruleRefs.ca4Local40],
        'Wait until judgment is entered before filing a rehearing petition.',
      )
    },
  },
  {
    id: 'bill_of_costs_after_judgment',
    source: 'frap',
    ruleRefs: [ruleRefs.frap39, ruleRefs.ca4Local39],
    eventIds: ['bill_of_costs'],
    severity: 'error',
    evaluate(context) {
      if (context.submission.eventId !== 'bill_of_costs') return null
      if (context.session.status === 'closed' || context.session.procedureState === 'judgment_entered') {
        return null
      }
      return validationIssue(
        'error',
        'bill_of_costs_before_judgment',
        'A bill of costs is not available before judgment.',
        [ruleRefs.frap39, ruleRefs.ca4Local39],
        'File costs only after judgment and within the applicable post-judgment cost window.',
      )
    },
  },
  {
    id: 'mandate_stay_after_judgment',
    source: 'frap',
    ruleRefs: [ruleRefs.frap41, ruleRefs.ca4Local41],
    eventIds: ['mandate_stay_motion'],
    severity: 'error',
    evaluate(context) {
      if (context.submission.eventId !== 'mandate_stay_motion') return null
      if (context.session.status === 'closed' || context.session.procedureState === 'judgment_entered') {
        return null
      }
      return validationIssue(
        'error',
        'mandate_stay_before_judgment',
        'A motion to stay the mandate is not available before judgment.',
        [ruleRefs.frap41, ruleRefs.ca4Local41],
        'Wait until judgment creates a mandate schedule before seeking a mandate stay.',
      )
    },
  },
  {
    id: 'local_rule_45_opening_default',
    source: 'ca4-local',
    ruleRefs: [ruleRefs.ca4Local45],
    eventIds: ['opening_brief'],
    severity: 'warning',
    evaluate(context) {
      if (context.submission.eventId !== 'opening_brief') return null
      const events = filedEvents(context.session)
      const missing = ['appearance_disclosure', 'docketing_statement', 'transcript_order_acknowledgment'].filter(
        (eventId) => !events.has(eventId),
      )
      if (!missing.length) return null
      return validationIssue(
        'warning',
        'local_rule_45_opening_stage_default_risk',
        `Opening-stage filings remain missing: ${missing.map((eventId) => eventId.replaceAll('_', ' ')).join(', ')}.`,
        [ruleRefs.ca4Local45],
        'Cure missing opening-stage filings to avoid default, dismissal, or a clerk deficiency order.',
      )
    },
  },
]

function constraintApplies(constraint: FilingConstraint, context: ConstraintContext) {
  if (constraint.eventIds && !constraint.eventIds.includes(context.submission.eventId)) {
    return false
  }
  if (
    constraint.participantRoles &&
    !constraint.participantRoles.includes(context.submission.participantRole)
  ) {
    return false
  }
  return true
}

export function evaluateFilingConstraints(
  session: CaseSession,
  submission: FilingSubmission,
  nowIso = new Date().toISOString(),
): ValidationIssue[] {
  const context = { session, submission, nowIso }
  const issues: ValidationIssue[] = []
  const seenCodes = new Set<string>()

  for (const constraint of filingConstraints) {
    if (!constraintApplies(constraint, context)) continue
    const issue = constraint.evaluate(context)
    if (!issue) continue
    const key = issue.code ?? issue.message
    if (seenCodes.has(key)) continue
    seenCodes.add(key)
    issues.push(issue)
  }

  return issues
}

export function preflightFilingSubmission(
  session: CaseSession,
  submission: FilingSubmission,
  nowIso = new Date().toISOString(),
): PreflightCheckResult {
  const issues = [
    ...evaluateFilingConstraints(session, submission, nowIso),
    ...validateAmicusSubmission(session, submission),
    ...briefAnalysisIssues(session, submission),
  ]
  const outcome = outcomeForIssues(issues)

  return {
    accepted: outcome !== 'rejected',
    outcome,
    issues,
    analyzedAt: nowIso,
  }
}
