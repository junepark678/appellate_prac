import { fileDraft, filingDateForSession } from '../simulation'
import { getCourtPack, getFilingEvent, ruleRefs } from '../packs'
import type {
  CaseSession,
  EcfEventCategory,
  EcfEventDefinition,
  EcfEventAvailability,
  EcfReceipt,
  FilingEvent,
  FilingDraft,
  FilingMetadata,
  FilingSubmission,
  NoticeOfDocketActivity,
  PreflightCheckResult,
  UploadedDocument,
  ValidationIssue,
} from '../types'
import { preflightFilingSubmission } from '../rules/executable-constraints'
import {
  CA4_ECF_EVENTS_URL,
  ecfCategoryFromCatalog,
  getCa4EcfCatalogEvent,
} from './ca4-ecf-catalog'
import { ca4SourceVersionIds } from '../rules/ca4-source-profile'

export function defaultFilingMetadata(eventId: string, sealed = false): FilingMetadata {
  const isCaseOpening = ['notice_of_appeal', 'criminal_notice_of_appeal', 'petition_for_review', 'petition_for_writ_mandamus'].includes(eventId)
  const isBrief = eventId.includes('brief') || eventId === 'corrected_brief'
  const feePaymentStatus = isCaseOpening ? 'pending' : 'not_required'

  return {
    filingAttorneyName: 'Simulated ECF Filer',
    feePaymentStatus,
    serviceMethod: 'cm_ecf',
    emergency: eventId === 'motion_stay_pending_appeal',
    sealed,
    redactionAcknowledged: !sealed,
    privacyAcknowledged: !sealed,
    publicRedactedVersionIncluded: !sealed,
    certificateOfService: true,
    certificateOfCompliance: isBrief,
    ...(eventId.includes('amicus') ? { consentStatus: 'unknown' as const } : {}),
    ...(sealed ? { sealedDocumentType: 'sealed material' } : {}),
  }
}

export function filingDraftToSubmission(
  draft: FilingDraft,
  metadataOverrides: Partial<FilingMetadata> = {},
): FilingSubmission | null {
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
      ...metadataOverrides,
      certificateOfService: draft.certificateOfService,
      certificateOfCompliance: draft.certificateOfCompliance,
      sealed: draft.sealed,
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
  if (['appearance_disclosure', 'docketing_statement', 'transcript_order_acknowledgment'].includes(eventId)) {
    return 'appearance'
  }
  if (eventId.includes('appendix')) return 'appendix'
  if (eventId === 'rule_28j_letter') return 'brief'
  if (eventId.includes('brief') || eventId === 'corrected_brief') return 'brief'
  if (eventId.includes('response')) return 'response'
  if (eventId.includes('seal')) return 'sealed'
  if (eventId.includes('amicus')) return 'amicus'
  if (eventId.includes('rehearing') || eventId.includes('mandate') || eventId === 'bill_of_costs') return 'post_disposition'
  return 'motion'
}

export function ecfEventDefinitionFromFilingEvent(event: FilingEvent): EcfEventDefinition {
  const catalogEvent = getCa4EcfCatalogEvent(event.id)
  const isBrief = event.id.includes('brief') || event.id === 'corrected_brief'
  const isSealed = event.id.includes('seal')
  const isCaseOpening = event.id === 'notice_of_appeal'
  const category =
    event.ecfCategory ??
    (catalogEvent ? ecfCategoryFromCatalog(catalogEvent.category) : categoryForEvent(event.id))
  const requiresRelatedEntry =
    catalogEvent?.requiredFields.includes('relatedDocketEntryId') ??
    event.requiresRelatedEntry ??
    (event.id.includes('response') || event.id === 'corrected_brief')
  const requiresReliefText =
    catalogEvent?.requiredFields.includes('reliefRequested') ??
    event.requiresReliefText ??
    (event.id.includes('motion') || event.id === 'motion')
  const feeBehavior =
    catalogEvent?.feeBehavior ??
    event.feeBehavior ??
    (isCaseOpening ? 'required' : event.id.includes('ifp') ? 'waivable' : 'none')
  const serviceBehavior =
    catalogEvent?.serviceBehavior ??
    event.serviceBehavior ??
    (event.allowedParticipantRoles.includes('amicus') ? 'mixed' : 'cm_ecf')

  return {
    eventId: event.id,
    category,
    displayName: event.label,
    courtEventName: catalogEvent?.courtEventName ?? event.label,
    sourceUrl: catalogEvent ? CA4_ECF_EVENTS_URL : undefined,
    sourceVersionIds: catalogEvent?.sourceVersionIds,
    reliefOptions: catalogEvent?.reliefs,
    eligibleRoles: event.allowedParticipantRoles,
    requiresMainDocument: event.requiredDocuments.length > 0,
    requiredAttachments: event.requiredDocuments.slice(1).map((requirement) => requirement.label),
    optionalAttachments: event.optionalDocuments.map((requirement) => requirement.label),
    metadataFields: [
      {
        key: 'filingAttorneyName',
        label: 'Filing attorney',
        inputType: 'text',
        required: true,
      },
      {
        key: 'representedPartyId',
        label: 'Represented party',
        inputType: 'text',
        required:
          catalogEvent?.requiredFields.includes('representedPartyId') ??
          event.partySelectionMode !== 'none',
      },
      {
        key: 'reliefRequested',
        label: 'Relief requested',
        inputType: catalogEvent?.reliefs.length ? 'select' : 'text',
        required: requiresReliefText,
        ...(catalogEvent?.reliefs.length ? { options: catalogEvent.reliefs } : {}),
      },
      {
        key: 'relatedDocketEntryId',
        label: 'Related docket entry',
        inputType: 'docket_entry_ref',
        required: requiresRelatedEntry,
      },
      {
        key: 'feePaymentStatus',
        label: 'Fee status',
        inputType: 'select',
        required: feeBehavior !== 'none',
        options: ['not_required', 'paid', 'deferred', 'waived', 'pending'],
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
        required:
          catalogEvent?.requiredFields.includes('certificateOfCompliance') ??
          isBrief,
      },
      {
        key: 'sealed',
        label: 'Sealed filing',
        inputType: 'checkbox',
        required:
          catalogEvent?.requiredFields.includes('sealed') ??
          (isSealed || category === 'sealed'),
      },
      {
        key: 'privacyAcknowledged',
        label: 'Privacy and redaction acknowledged',
        inputType: 'checkbox',
        required:
          catalogEvent?.requiredFields.includes('privacyAcknowledged') ??
          (isSealed || category === 'sealed'),
      },
      {
        key: 'publicRedactedVersionIncluded',
        label: 'Public redacted version included',
        inputType: 'checkbox',
        required:
          catalogEvent?.requiredFields.includes('publicRedactedVersionIncluded') ??
          (isSealed || category === 'sealed'),
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
    menuPath: catalogEvent?.menuPath ?? event.ecfMenuPath ?? ['Other Filings', event.label],
    courtEventCode: event.courtEventCode ?? event.id.toUpperCase(),
    requiresRelatedEntry,
    requiresReliefText,
    feeBehavior,
    serviceBehavior,
    partySelectionMode: event.partySelectionMode ?? 'single',
    receiptTemplateId: event.receiptTemplateId ?? 'standard_noda',
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

function formatParticipant(role: string) {
  return role
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function docketTextForSubmission(
  session: CaseSession,
  submission: FilingSubmission,
  filingId: string,
  preview = false,
) {
  const event = getFilingEvent(session.courtPackId, submission.eventId)
  const baseText =
    event?.docketTextTemplate
      .replace('{participant}', formatParticipant(submission.participantRole))
      .replace('{title}', submission.title) ??
    `${submission.title} filed by ${formatParticipant(submission.participantRole)}.`
  const relatedEntry = submission.metadata.relatedDocketEntryId
    ? session.docketEntries.find((entry) => entry.id === submission.metadata.relatedDocketEntryId)
    : undefined
  const relief = submission.metadata.reliefRequested?.trim()
  const sealed = submission.metadata.sealed ? ' Filed under seal.' : ''
  const related = relatedEntry
    ? ` Related docket entry: ${relatedEntry.entryNumber}.`
    : ''
  const reliefText = relief ? ` Relief requested: ${relief}.` : ''
  const filingText = preview ? ' Filing ID: preview.' : ` Filing ID: ${filingId}.`

  return `${baseText}${reliefText}${related}${sealed}${filingText} Service: ${submission.metadata.serviceMethod.replaceAll('_', ' ')}.`
}

export function serviceRecipientsForSubmission(
  session: CaseSession,
  submission: FilingSubmission,
) {
  const suppressed = new Set(submission.metadata.serviceListOverrides?.suppressedParticipantIds ?? [])
  const participants = session.participants
    .filter((participant) =>
      ['appellant', 'appellee', 'petitioner', 'respondent', 'amicus', 'agency'].includes(participant.role),
    )
    .filter((participant) => !suppressed.has(participant.id))
    .map((participant) => participant.displayName)
  const additional = submission.metadata.serviceListOverrides?.additionalRecipients ?? []
  const manual = submission.metadata.serviceListOverrides?.manualServiceRecipients ?? []
  return [...new Set([...participants, ...additional, ...manual])]
}

export function buildNoticeOfDocketActivityPreview(
  session: CaseSession,
  submission: FilingSubmission,
): NoticeOfDocketActivity {
  return {
    receiptNumber: receiptNumber(session, session.filings.length),
    docketText: docketTextForSubmission(session, submission, 'preview', true),
    recipients: serviceRecipientsForSubmission(session, submission),
    generatedAt: session.simulatedDate,
  }
}

export function createNoticeOfDocketActivity(
  session: CaseSession,
  submission: FilingSubmission,
  filingId: string,
): NoticeOfDocketActivity {
  const preview = buildNoticeOfDocketActivityPreview(session, submission)

  return {
    ...preview,
    docketText: docketTextForSubmission(session, submission, filingId),
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

function ecfCompletenessIssue(
  code: string,
  message: string,
  cureSuggestion: string,
  ruleRefsForIssue = [ruleRefs.frap25, ruleRefs.ca4Local25],
  sourceVersionIds: string[] = [
    ca4SourceVersionIds.frap2025,
    ca4SourceVersionIds.ca4LocalRules2026,
    ca4SourceVersionIds.ca4EcfEvents2026,
  ],
): ValidationIssue {
  return {
    severity: 'error',
    code,
    message,
    ruleRefs: ruleRefsForIssue,
    sourceVersionIds,
    cureSuggestion,
  }
}

export function validateEcfWizardCompleteness(
  session: CaseSession,
  submission: FilingSubmission,
): ValidationIssue[] {
  const event = getFilingEvent(session.courtPackId, submission.eventId)
  if (!event) {
    return [
      ecfCompletenessIssue(
        'ecf_event_unavailable',
        'The selected CM/ECF event is not available in this court pack.',
        'Select a court-published CM/ECF event before filing.',
        [],
      ),
    ]
  }

  const definition = ecfEventDefinitionFromFilingEvent(event)
  const catalogEvent = getCa4EcfCatalogEvent(event.id)
  const issues: ValidationIssue[] = []

  if (!submission.metadata.filingAttorneyName?.trim()) {
    issues.push(
      ecfCompletenessIssue(
        'ecf_filing_attorney_missing',
        'CM/ECF metadata requires a filing attorney name.',
        'Enter the simulated filing attorney before submission.',
      ),
    )
  }

  const hasRepresentedParty =
    Boolean(submission.metadata.representedPartyId?.trim()) ||
    session.participants.some((participant) => participant.role === submission.participantRole)
  if (definition.partySelectionMode !== 'none' && !hasRepresentedParty) {
    issues.push(
      ecfCompletenessIssue(
        'ecf_represented_party_missing',
        'CM/ECF metadata requires a represented party selection.',
        'Select the party on whose behalf this filing is submitted.',
      ),
    )
  }

  if (
    definition.requiresReliefText &&
    !submission.metadata.reliefRequested?.trim()
  ) {
    issues.push(
      ecfCompletenessIssue(
        'ecf_motion_relief_missing',
        'This CM/ECF event requires relief-requested text before rule preflight.',
        'Enter the motion relief or procedural action requested.',
        [ruleRefs.frap27, ruleRefs.ca4Local27],
      ),
    )
  }

  if (
    catalogEvent?.reliefs.length &&
    submission.metadata.reliefRequested?.trim() &&
    !catalogEvent.reliefs.some(
      (relief) =>
        relief.toLowerCase() === submission.metadata.reliefRequested?.trim().toLowerCase(),
    )
  ) {
    issues.push(
      ecfCompletenessIssue(
        'ecf_motion_relief_not_in_catalog',
        'The requested relief is not one of the source-mapped Fourth Circuit motion relief options for this event.',
        'Select a relief option from the court event catalog or use the generic motion event if appropriate.',
        [ruleRefs.frap27, ruleRefs.ca4Local27],
        catalogEvent.sourceVersionIds,
      ),
    )
  }

  if (definition.requiresRelatedEntry) {
    const relatedId = submission.metadata.relatedDocketEntryId
    const relatedEntry = relatedId
      ? session.docketEntries.find((entry) => entry.id === relatedId)
      : undefined
    if (!relatedEntry) {
      issues.push(
        ecfCompletenessIssue(
          'ecf_related_docket_entry_missing',
          'This CM/ECF event requires a related docket entry selection before rule preflight.',
          'Select the motion, deficiency notice, judgment, or docket entry this filing relates to.',
          [ruleRefs.frap25, ruleRefs.frap27],
        ),
      )
    }
  }

  if (
    definition.feeBehavior !== 'none' &&
    (!submission.metadata.feePaymentStatus ||
      submission.metadata.feePaymentStatus === 'not_required')
  ) {
    issues.push(
      ecfCompletenessIssue(
        'ecf_fee_status_missing',
        'This CM/ECF event requires fee-payment or fee-waiver status.',
        'Select paid, deferred, waived, or pending fee status.',
        [ruleRefs.frap3, ruleRefs.ca4Local3],
      ),
    )
  }

  const sealedByEvent = definition.category === 'sealed' || submission.metadata.sealed
  if (sealedByEvent) {
    if (!submission.metadata.sealedDocumentType?.trim()) {
      issues.push(
        ecfCompletenessIssue(
          'ecf_sealed_document_type_missing',
          'Sealed CM/ECF events require a sealed document type.',
          'Identify whether the document is a sealed brief, sealed appendix, sealed document, or sealing motion.',
        ),
      )
    }
    if (!submission.metadata.privacyAcknowledged && !submission.metadata.redactionAcknowledged) {
      issues.push(
        ecfCompletenessIssue(
          'ecf_privacy_acknowledgment_missing',
          'Sealed filings require privacy and redaction acknowledgement before submission.',
          'Acknowledge redaction responsibility for sealed or personal-identifier material.',
        ),
      )
    }
    if (
      !submission.eventId.includes('appendix') &&
      !submission.metadata.publicRedactedVersionIncluded
    ) {
      issues.push(
        ecfCompletenessIssue(
          'ecf_public_redacted_version_missing',
          'Sealed briefs, motions, and documents require a public redacted version in this simulator.',
          'Include or certify the public redacted version before submitting the sealed filing.',
        ),
      )
    }
  }

  return issues
}

export type EcfSubmissionResult = {
  preflight: PreflightCheckResult
  session: CaseSession
  receipt: EcfReceipt | null
}

export function preflightEcfFiling(
  session: CaseSession,
  submission: FilingSubmission,
  nowIso = filingDateForSession(session),
): PreflightCheckResult {
  const completenessIssues = validateEcfWizardCompleteness(session, submission)
  if (completenessIssues.some((issue) => issue.severity === 'error')) {
    return {
      accepted: false,
      outcome: 'rejected',
      issues: completenessIssues,
      analyzedAt: nowIso,
    }
  }

  const rulePreflight = preflightFilingSubmission(session, submission, nowIso)
  return {
    ...rulePreflight,
    issues: [...completenessIssues, ...rulePreflight.issues],
  }
}

function hasAcceptedEvent(session: CaseSession, eventId: string) {
  return session.filings.some(
    (filing) => filing.eventId === eventId && filing.outcome !== 'rejected',
  )
}

function hasOpenDeadline(session: CaseSession, eventId: string) {
  return session.deadlines.some(
    (deadline) => deadline.targetEventId === eventId && deadline.status === 'open',
  )
}

function latestOpenDeadline(session: CaseSession, eventId: string) {
  return session.deadlines
    .filter((deadline) => deadline.targetEventId === eventId && deadline.status === 'open')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}

function availabilityReasons(session: CaseSession, event: FilingEvent) {
  const reasons: string[] = []
  const status = session.status
  const courtPack = getCourtPack(session.courtPackId)
  const openingEventId =
    courtPack.procedureDomain === 'criminal_appeal'
      ? 'criminal_notice_of_appeal'
      : courtPack.procedureDomain === 'agency_review'
        ? 'petition_for_review'
        : courtPack.procedureDomain === 'original_writ'
          ? 'petition_for_writ_mandamus'
          : 'notice_of_appeal'
  const docketingEventId =
    courtPack.procedureDomain === 'criminal_appeal'
      ? 'criminal_docketing_statement'
      : courtPack.procedureDomain === 'agency_review'
        ? 'agency_docketing_statement'
        : courtPack.procedureDomain === 'original_writ'
          ? 'writ_docketing_statement'
          : 'docketing_statement'

  if (status === 'closed' && !['petition_rehearing', 'mandate_stay_motion', 'bill_of_costs'].includes(event.id)) {
    reasons.push('Only rehearing, costs, and mandate-stay events are available after judgment.')
  }

  if (status !== 'closed' && ['petition_rehearing', 'mandate_stay_motion', 'bill_of_costs'].includes(event.id)) {
    reasons.push('This is a post-disposition event and is unavailable before judgment.')
  }

  if (event.id === openingEventId && hasAcceptedEvent(session, openingEventId)) {
    reasons.push('The opening case-initiating filing has already been docketed.')
  }

  if (
    ['appearance_disclosure', docketingEventId, 'transcript_order_acknowledgment', 'cja_financial_disclosure', 'certified_agency_record', 'appendix_to_writ_petition'].includes(event.id) &&
    !hasAcceptedEvent(session, openingEventId)
  ) {
    reasons.push('The case-initiating filing must be filed first.')
  }

  if (event.id === 'opening_brief') {
    const recordReady =
      courtPack.procedureDomain === 'agency_review'
        ? hasAcceptedEvent(session, docketingEventId) && hasAcceptedEvent(session, 'certified_agency_record')
        : hasAcceptedEvent(session, docketingEventId) &&
          hasAcceptedEvent(session, 'transcript_order_acknowledgment')
    if (!recordReady) {
      reasons.push('The Fourth Circuit briefing schedule is not issued until record-ordering prerequisites are complete or the clerk determines the record is complete.')
    }
    if (!hasOpenDeadline(session, 'opening_brief')) {
      reasons.push('No formal opening-brief schedule is currently open.')
    }
  }

  if (event.id === 'joint_appendix' && !hasOpenDeadline(session, 'opening_brief') && !hasAcceptedEvent(session, 'opening_brief')) {
    reasons.push('The joint appendix belongs with the formal briefing schedule.')
  }

  if (event.id === 'appellee_brief') {
    if (!hasAcceptedEvent(session, 'opening_brief')) {
      reasons.push('The appellee brief cannot precede the opening brief.')
    }
    if (!hasAcceptedEvent(session, 'joint_appendix')) {
      reasons.push('The appellee brief should follow the joint appendix posture.')
    }
    if (!latestOpenDeadline(session, 'appellee_brief')) {
      reasons.push('No appellee-brief deadline is currently open.')
    }
  }

  if (event.id === 'reply_brief' && !hasAcceptedEvent(session, 'appellee_brief')) {
    reasons.push('The reply brief cannot precede the appellee brief.')
  }

  if (event.id === 'motion_response' && !hasOpenDeadline(session, 'motion_response')) {
    reasons.push('No response-to-motion deadline is currently open.')
  }

  if (event.id === 'response_to_amicus_motion' && !hasOpenDeadline(session, 'response_to_amicus_motion')) {
    reasons.push('No response-to-amicus-motion deadline is currently open.')
  }

  if (event.id === 'motion_to_supplement_record' && !hasAcceptedEvent(session, 'certified_agency_record')) {
    reasons.push('The certified agency record should be filed before supplement-record motion practice.')
  }

  if (event.id === 'answer_to_writ_petition' && !hasOpenDeadline(session, 'answer_to_writ_petition')) {
    reasons.push('An answer to a writ petition is filed only after the court invites or directs an answer.')
  }

  if (event.id === 'reply_in_support_of_writ' && !hasAcceptedEvent(session, 'answer_to_writ_petition')) {
    reasons.push('The writ reply cannot precede an answer.')
  }

  if (
    ['amicus_notice_or_consent', 'motion_for_leave_to_file_amicus', 'amicus_brief'].includes(event.id) &&
    !hasAcceptedEvent(session, 'opening_brief')
  ) {
    reasons.push('Amicus participation is evaluated after the opening brief.')
  }

  if (event.id === 'corrected_brief') {
    const hasBrief = ['opening_brief', 'appellee_brief', 'reply_brief', 'amicus_brief'].some((eventId) =>
      hasAcceptedEvent(session, eventId),
    )
    if (!hasBrief) {
      reasons.push('A corrected brief requires an earlier brief or deficiency entry.')
    }
  }

  return reasons
}

export function getAvailableEcfEventDefinitions(session: CaseSession): EcfEventAvailability[] {
  const courtPack = getCourtPack(session.courtPackId)
  return courtPack.filingEvents.map((event) => {
    const unavailableReasons = availabilityReasons(session, event)
    const definition = ecfEventDefinitionFromFilingEvent(event)
    return {
      ...definition,
      available: unavailableReasons.length === 0,
      unavailableReasons,
      availabilityReason: unavailableReasons.length
        ? unavailableReasons.join(' ')
        : `${definition.courtEventName ?? definition.displayName} is available in the source-mapped Fourth Circuit CM/ECF catalog.`,
    }
  })
}

export function submitEcfFiling(
  session: CaseSession,
  submission: FilingSubmission,
): EcfSubmissionResult {
  const filedAt = filingDateForSession(session)
  const preflight = preflightEcfFiling(session, submission, filedAt)
  if (!preflight.accepted && validateEcfWizardCompleteness(session, submission).some((issue) => issue.severity === 'error')) {
    return {
      preflight,
      session,
      receipt: null,
    }
  }

  const draft = filingSubmissionToDraft(submission)
  const filedSession = fileDraft(session, draft, {
    filedAt,
    validationIssues: preflight.issues,
    submission,
  })
  const newestFiling = filedSession.filings.at(-1)
  const nextSession =
    newestFiling && (submission.filerPartyId || submission.partyIds?.length)
      ? {
          ...filedSession,
          filings: filedSession.filings.map((filing) =>
            filing.id === newestFiling.id
              ? {
                  ...filing,
                  ...(submission.filerPartyId
                    ? { filerPartyId: submission.filerPartyId }
                    : {}),
                  ...(submission.partyIds?.length ? { partyIds: submission.partyIds } : {}),
                }
              : filing,
          ),
        }
      : filedSession
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
