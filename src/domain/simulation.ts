import {
  getCourtPack,
  getFilingEvent,
  getScenario,
  criminalOpeningBriefDeadline,
  openingBriefDeadline,
  ruleRefs,
} from './packs'
import { isImplementedAiTool } from './tools'
import { updateAmicusAfterAcceptedFiling, withAmicusRecommendations } from './amicus/workflow'
import { counterpartyBriefText, withCounterpartyStrategy } from './counterparty/strategy'
import {
  addBenchMemo,
  addPanelVote,
  assignPanel,
  canSubmitToPanel,
  createBenchMemo,
  createPanelDisposition,
  deterministicPanelVote,
  enterPanelDisposition,
  nextPanelJudgeActorId,
  validatePanelDisposition,
  validatePanelVote,
} from './panel/deliberation'
import { preflightFilingSubmission, sessionJurisdictionIssues } from './rules/executable-constraints'
import {
  calculateDeadlineDueDate,
  deadlineRuleForTrigger,
} from './rules/deadline-calculator'
import type {
  Assessment,
  CaseSession,
  Deadline,
  DocketEntry,
  FilingEvent,
  FilingDraft,
  FilingRecord,
  ParticipantRole,
  Participant,
  RuleRef,
  PanelVote,
  ToolCall,
  ToolValidationResult,
  UploadedDocument,
  ValidationIssue,
} from './types'

const simulatorStart = '2026-05-23T09:00:00.000Z'
type RuntimeToolCall = {
  tool: string
  actorId?: string
  [key: string]: unknown
}

function addDays(dateIso: string, days: number) {
  const date = new Date(dateIso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function inferredDeadlineTrigger(targetEventId: string) {
  if (targetEventId === 'notice_of_appeal') return 'civil_judgment'
  if (targetEventId === 'criminal_notice_of_appeal') return 'criminal_judgment'
  if (targetEventId === 'petition_for_review') return 'agency_order'
  if (targetEventId === 'petition_for_writ_mandamus') return 'challenged_order'
  if (targetEventId === 'opening_brief') return 'briefing_schedule'
  return undefined
}

function formatParticipant(role: string) {
  return role
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function makeId(prefix: string, count: number) {
  return `${prefix}_${String(count + 1).padStart(4, '0')}`
}

function nextDocketNumber(session: CaseSession) {
  return session.docketEntries.length + 1
}

function createDocketEntry(
  session: CaseSession,
  entry: Omit<DocketEntry, 'id' | 'entryNumber'>,
): DocketEntry {
  return {
    ...entry,
    id: makeId('dkt', session.docketEntries.length),
    entryNumber: nextDocketNumber(session),
  }
}

function createDeadline(
  session: CaseSession,
  label: string,
  targetEventId: string,
  sourceEntryId: string,
  offsetDays: number,
  sourceRuleRefs: RuleRef[],
  triggerEventId = inferredDeadlineTrigger(targetEventId),
): Deadline {
  const sourceBackedRule = triggerEventId
    ? deadlineRuleForTrigger(triggerEventId, targetEventId)
    : undefined
  const useSourceBackedRule =
    sourceBackedRule &&
    sourceBackedRule.offset === offsetDays &&
    sourceBackedRule.unit === 'calendar_day'
  return {
    id: makeId('deadline', session.deadlines.length),
    label,
    dueDate: useSourceBackedRule
      ? calculateDeadlineDueDate(session.simulatedDate, sourceBackedRule)
      : addDays(session.simulatedDate, offsetDays),
    targetEventId,
    sourceEntryId,
    status: 'open',
    sourceRuleRefs: useSourceBackedRule ? sourceBackedRule.ruleRefs : sourceRuleRefs,
  }
}

function isImplementedToolName(tool: string): tool is ToolCall['tool'] {
  return isImplementedAiTool(tool) && isSupportedRuntimeTool(tool)
}

function isSupportedRuntimeTool(tool: string): tool is ToolCall['tool'] {
  return [
    'issueClerkOrder',
    'fileCounterpartyDocument',
    'setDeadline',
    'submitToPanel',
    'issuePanelOrder',
    'disposeCase',
    'draftStaffMemo',
    'castRuntimePanelVote',
    'draftRuntimePanelDisposition',
    'enterJudgment',
    'setMandateDeadline',
  ].includes(tool)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRuleRefArray(value: unknown): value is RuleRef[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        isString((item as RuleRef).ruleId) &&
        isString((item as RuleRef).label) &&
        isString((item as RuleRef).sourceUrl),
    )
  )
}

function normalizeToolCall(toolCall: ToolCall | RuntimeToolCall): ToolCall | null {
  if (!isImplementedToolName(toolCall.tool) || !isString(toolCall.actorId)) {
    return null
  }

  if (toolCall.tool === 'issueClerkOrder') {
    return isString(toolCall.title) &&
      isString(toolCall.text) &&
      isRuleRefArray(toolCall.ruleRefs)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          title: toolCall.title,
          text: toolCall.text,
          ruleRefs: toolCall.ruleRefs,
        }
      : null
  }

  if (toolCall.tool === 'fileCounterpartyDocument') {
    return isString(toolCall.eventId) &&
      isString(toolCall.title) &&
      isString(toolCall.text)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          eventId: toolCall.eventId,
          title: toolCall.title,
          text: toolCall.text,
        }
      : null
  }

  if (toolCall.tool === 'setDeadline') {
    return isString(toolCall.label) &&
      isString(toolCall.targetEventId) &&
      isNumber(toolCall.offsetDays) &&
      isRuleRefArray(toolCall.sourceRuleRefs)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          label: toolCall.label,
          targetEventId: toolCall.targetEventId,
          offsetDays: toolCall.offsetDays,
          sourceRuleRefs: toolCall.sourceRuleRefs,
        }
      : null
  }

  if (toolCall.tool === 'submitToPanel') {
    return isString(toolCall.text)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          text: toolCall.text,
        }
      : null
  }

  if (toolCall.tool === 'issuePanelOrder') {
    return isString(toolCall.title) &&
      isString(toolCall.text) &&
      isRuleRefArray(toolCall.ruleRefs)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          title: toolCall.title,
          text: toolCall.text,
          ruleRefs: toolCall.ruleRefs,
        }
      : null
  }

  if (toolCall.tool === 'disposeCase') {
    return isString(toolCall.disposition) &&
      isString(toolCall.text) &&
      isRuleRefArray(toolCall.ruleRefs)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          disposition: toolCall.disposition,
          text: toolCall.text,
          ruleRefs: toolCall.ruleRefs,
        }
      : null
  }

  if (toolCall.tool === 'draftStaffMemo') {
    return isString(toolCall.text) &&
      Array.isArray(toolCall.issueSummaries) &&
      toolCall.issueSummaries.every(isString) &&
      isString(toolCall.recommendedDisposition) &&
      Array.isArray(toolCall.risks) &&
      toolCall.risks.every(isString)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          text: toolCall.text,
          issueSummaries: toolCall.issueSummaries,
          recommendedDisposition: toolCall.recommendedDisposition,
          risks: toolCall.risks,
        }
      : null
  }

  if (toolCall.tool === 'castRuntimePanelVote') {
    return isString(toolCall.vote) &&
      ['affirm', 'reverse', 'vacate', 'vacate_in_part', 'dismiss', 'remand'].includes(
        toolCall.vote,
      ) &&
      isString(toolCall.reliefOption) &&
      isString(toolCall.rationale) &&
      typeof toolCall.joinsMajority === 'boolean' &&
      isNumber(toolCall.confidence)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          vote: toolCall.vote as PanelVote['vote'],
          reliefOption: toolCall.reliefOption,
          rationale: toolCall.rationale,
          joinsMajority: toolCall.joinsMajority,
          ...(['concurrence', 'dissent', 'concur_in_judgment'].includes(
            String(toolCall.separateWritingType),
          )
            ? {
                separateWritingType: toolCall.separateWritingType as
                  | 'concurrence'
                  | 'dissent'
                  | 'concur_in_judgment',
              }
            : {}),
          confidence: toolCall.confidence,
        }
      : null
  }

  if (toolCall.tool === 'draftRuntimePanelDisposition') {
    return isString(toolCall.disposition) &&
      isString(toolCall.text) &&
      isString(toolCall.judgmentText) &&
      isRuleRefArray(toolCall.ruleRefs)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          disposition: toolCall.disposition,
          text: toolCall.text,
          judgmentText: toolCall.judgmentText,
          ruleRefs: toolCall.ruleRefs,
        }
      : null
  }

  if (toolCall.tool === 'enterJudgment') {
    return isString(toolCall.disposition) &&
      isString(toolCall.judgmentText) &&
      isRuleRefArray(toolCall.ruleRefs)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          disposition: toolCall.disposition,
          judgmentText: toolCall.judgmentText,
          ruleRefs: toolCall.ruleRefs,
        }
      : null
  }

  if (toolCall.tool === 'setMandateDeadline') {
    return isString(toolCall.label) &&
      isNumber(toolCall.offsetDays) &&
      isRuleRefArray(toolCall.sourceRuleRefs)
      ? {
          tool: toolCall.tool,
          actorId: toolCall.actorId,
          label: toolCall.label,
          offsetDays: toolCall.offsetDays,
          sourceRuleRefs: toolCall.sourceRuleRefs,
        }
      : null
  }

  return null
}

function activeFilings(session: CaseSession) {
  return session.filings.filter((filing) => filing.outcome !== 'rejected')
}

function activeFiledEventSet(session: CaseSession) {
  return new Set(activeFilings(session).map((filing) => filing.eventId))
}

function procedureEventIds(session: CaseSession) {
  const courtPack = getCourtPack(session.courtPackId)
  if (courtPack.procedureDomain === 'criminal_appeal') {
    return {
      opening: 'criminal_notice_of_appeal',
      docketing: 'criminal_docketing_statement',
      record: 'transcript_order_acknowledgment',
      extra: 'cja_financial_disclosure',
      openingDeadline: criminalOpeningBriefDeadline,
      openingRuleRefs: [ruleRefs.frap3, ruleRefs.frap4b],
    }
  }
  if (courtPack.procedureDomain === 'agency_review') {
    return {
      opening: 'petition_for_review',
      docketing: 'agency_docketing_statement',
      record: 'certified_agency_record',
      extra: undefined,
      openingDeadline: openingBriefDeadline,
      openingRuleRefs: [ruleRefs.frap15, ruleRefs.ca4Local15],
    }
  }
  if (courtPack.procedureDomain === 'original_writ') {
    return {
      opening: 'petition_for_writ_mandamus',
      docketing: 'writ_docketing_statement',
      record: 'appendix_to_writ_petition',
      extra: undefined,
      openingDeadline: openingBriefDeadline,
      openingRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    }
  }
  return {
    opening: 'notice_of_appeal',
    docketing: 'docketing_statement',
    record: 'transcript_order_acknowledgment',
    extra: undefined,
    openingDeadline: openingBriefDeadline,
    openingRuleRefs: [ruleRefs.frap3, ruleRefs.frap4, ruleRefs.ca4Local3],
  }
}

function hasOpenDeadline(session: CaseSession, targetEventId: string) {
  return session.deadlines.some(
    (deadline) => deadline.targetEventId === targetEventId && deadline.status === 'open',
  )
}

function actorFilingRole(session: CaseSession, actorId: string): ParticipantRole | null {
  const actor = getCourtPack(session.courtPackId).aiActors.find(
    (candidate) => candidate.id === actorId,
  )

  if (!actor) return null
  if (actor.role === 'opposing_party') return 'appellee'
  if (actor.role === 'amicus') return 'amicus'
  return null
}

function syntheticDocumentsForEvent(event: FilingEvent): UploadedDocument[] {
  return event.requiredDocuments.map((requirement, index) => ({
    id: `ai_doc_${event.id}_${index + 1}`,
    fileName: `${event.id.replaceAll('_', '-')}.pdf`,
    mimeType: requirement.acceptedMimeTypes[0] ?? 'application/pdf',
    sizeBytes: 150_000,
    pageCount: Math.min(requirement.maxPages ?? 20, 20),
    extractedSignals: [
      ...(requirement.mustContain ?? []),
      'argument',
      event.id.includes('brief') ? 'jurisdiction' : '',
      event.id.includes('brief') ? 'conclusion' : '',
      event.id.includes('brief') ? 'record citation' : '',
      event.id.includes('brief') ? 'oral argument' : '',
      event.id === 'joint_appendix' ? 'pagination' : '',
      event.label.toLowerCase(),
    ].filter(Boolean),
  }))
}

function postProcessAcceptedFiling(session: CaseSession, draft: FilingDraft): CaseSession {
  let nextSession = session
  if (draft.participantRole === 'appellant') {
    nextSession = withCounterpartyStrategy(nextSession)
  }
  if (draft.eventId === 'opening_brief') {
    nextSession = withAmicusRecommendations(nextSession)
  }
  if (draft.participantRole === 'amicus' || draft.eventId.includes('amicus')) {
    nextSession = updateAmicusAfterAcceptedFiling(nextSession)
  }
  return nextSession
}

export function createInitialSession(scenarioId = 'synthetic-employment-retaliation'): CaseSession {
  const scenario = getScenario(scenarioId)
  const courtPack = getCourtPack(scenario.courtPackId)
  const participants: Participant[] =
    scenario.participants ??
    [
      { id: 'appellant', displayName: 'Maya Jordan', role: 'appellant' },
      { id: 'appellee', displayName: 'Meridian Analytics, Inc.', role: 'appellee' },
      { id: 'clerk', displayName: `${courtPack.label} Clerk`, role: 'clerk' },
      { id: 'panel', displayName: 'Three-Judge Panel', role: 'panel' },
      {
        id: 'district_court',
        displayName: scenario.lowerTribunal,
        role: 'district_court',
      },
    ]
  const openingEvent =
    courtPack.procedureDomain === 'criminal_appeal'
      ? {
          label: 'Criminal notice of appeal due',
          targetEventId: 'criminal_notice_of_appeal',
          offsetDays: 14,
          ruleRefs: [ruleRefs.frap4b],
        }
      : courtPack.procedureDomain === 'agency_review'
        ? {
            label: 'Petition for review due',
            targetEventId: 'petition_for_review',
            offsetDays: 30,
            ruleRefs: [ruleRefs.frap15],
          }
        : courtPack.procedureDomain === 'original_writ'
          ? {
              label: 'Original writ petition due',
              targetEventId: 'petition_for_writ_mandamus',
              offsetDays: 0,
              ruleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
            }
          : {
              label: 'Notice of appeal due',
              targetEventId: 'notice_of_appeal',
              offsetDays: 30,
              ruleRefs: [ruleRefs.frap4],
            }

  const session: CaseSession = {
    id: 'case_0001',
    scenario,
    courtPackId: scenario.courtPackId,
    status: 'active',
    autonomyMode: 'supervised',
    turnPolicy: {
      maxTurnsPerRun: 6,
      requireHumanApprovalFor: ['disposeCase', 'enterJudgment'],
      stopOnDeficiency: true,
    },
    sourceProfileId: `${scenario.courtPackId}-beta-2026`,
    qualityState: 'source_review_pending',
    simulatedDate: simulatorStart,
    participants,
    docketEntries: [],
    deadlines: [],
    filings: [],
  }

  const openingEntry = createDocketEntry(session, {
    filedAt: session.simulatedDate,
    actorRole: participants.some((participant) => participant.role === 'district_court')
      ? 'district_court'
      : participants.some((participant) => participant.role === 'agency')
        ? 'agency'
        : 'clerk',
    title: `${courtPack.procedureDomain.replaceAll('_', ' ')} opened`,
    text: `${scenario.shortCaption}. Proceeding docketed from ${scenario.lowerTribunal}. Record transmitted for simulator purposes.`,
    ruleRefs: openingEvent.ruleRefs,
  })

  return {
    ...session,
    docketEntries: [openingEntry],
    deadlines: [
      createDeadline(
        session,
        openingEvent.label,
        openingEvent.targetEventId,
        openingEntry.id,
        openingEvent.offsetDays,
        openingEvent.ruleRefs,
      ),
    ],
  }
}

export function inferDocumentSignals(file: File): UploadedDocument {
  const normalizedName = file.name.toLowerCase()
  const extractedSignals = [
    normalizedName.includes('notice') ? 'notice of appeal' : '',
    normalizedName.includes('petition-review') || normalizedName.includes('petition_for_review') ? 'petition for review' : '',
    normalizedName.includes('writ') ? 'writ' : '',
    normalizedName.includes('financial') || normalizedName.includes('cja') ? 'financial' : '',
    normalizedName.includes('record') ? 'record' : '',
    normalizedName.includes('answer') ? 'answer' : '',
    normalizedName.includes('disclosure') ? 'disclosure' : '',
    normalizedName.includes('docketing') ? 'docketing statement' : '',
    normalizedName.includes('transcript') ? 'transcript' : '',
    normalizedName.includes('motion') ? 'motion' : '',
    normalizedName.includes('stay') ? 'stay' : '',
    normalizedName.includes('response') ? 'response' : '',
    normalizedName.includes('reply') ? 'reply' : '',
    normalizedName.includes('brief') ? 'argument' : '',
    normalizedName.includes('appendix') ? 'appendix' : '',
    normalizedName.includes('amicus') ? 'amicus' : '',
    normalizedName.includes('rehearing') ? 'rehearing' : '',
    normalizedName.includes('28j') || normalizedName.includes('28-j') ? '28(j)' : '',
    normalizedName.includes('cost') ? 'costs' : '',
  ].filter(Boolean)

  return {
    id: `${file.name}-${file.lastModified}`,
    fileName: file.name,
    mimeType: file.type || 'application/pdf',
    sizeBytes: file.size,
    extractedSignals,
  }
}

function draftToSubmission(draft: FilingDraft) {
  const [mainDocument, ...attachmentDocuments] = draft.documents
  if (!mainDocument) return null

  return {
    eventId: draft.eventId,
    participantRole: draft.participantRole,
    title: draft.title,
    mainDocument,
    attachments: attachmentDocuments.map((document, index) => ({
      id: `draft_attachment_${index + 1}`,
      label: document.fileName,
      document,
      attachmentType: draft.eventId === 'joint_appendix' ? 'appendix' as const : 'other' as const,
    })),
    metadata: {
      serviceMethod: 'cm_ecf' as const,
      ...(draft.eventId.includes('amicus') ? { consentStatus: 'unknown' as const } : {}),
      ...(draft.sealed ? { sealedDocumentType: 'sealed material' } : {}),
      emergency: draft.eventId === 'motion_stay_pending_appeal',
      sealed: draft.sealed,
      redactionAcknowledged: !draft.sealed,
      certificateOfService: draft.certificateOfService,
      certificateOfCompliance: draft.certificateOfCompliance,
    },
    notes: draft.notes,
  }
}

export function validateFiling(
  session: CaseSession,
  draft: FilingDraft,
): ValidationIssue[] {
  const submission = draftToSubmission(draft)
  if (!submission) {
    const event = getFilingEvent(session.courtPackId, draft.eventId)
    return [
      {
        severity: 'error',
        code: event ? `required_document_${event.requiredDocuments[0]?.id ?? 'main'}_missing` : 'required_document_missing',
        message: event?.requiredDocuments[0]?.label
          ? `${event.requiredDocuments[0].label} is required.`
          : 'A main document is required.',
        ruleRefs: event?.validationRuleRefs ?? [],
        cureSuggestion: 'Attach the required PDF before filing.',
      },
    ]
  }

  return preflightFilingSubmission(session, submission, session.simulatedDate).issues
}

export function fileDraft(session: CaseSession, draft: FilingDraft): CaseSession {
  const event = getFilingEvent(session.courtPackId, draft.eventId)
  const validationIssues = validateFiling(session, draft)
  const hasErrors = validationIssues.some((issue) => issue.severity === 'error')
  const hasWarnings = validationIssues.some((issue) => issue.severity === 'warning')
  const filedAt = addDays(session.simulatedDate, 1)
  const filingId = makeId('filing', session.filings.length)
  const filing: FilingRecord = {
    ...draft,
    id: filingId,
    filedAt,
    outcome: hasErrors
      ? 'rejected'
      : hasWarnings
        ? 'accepted_with_deficiency'
        : 'accepted',
    validationIssues,
  }

  if (hasErrors) {
    const rejectionEntry = createDocketEntry(session, {
      filedAt,
      actorRole: 'clerk',
      title: 'Clerk Notice of Rejected Filing',
      text: validationIssues.map((issue) => issue.message).join(' '),
      ruleRefs: validationIssues.flatMap((issue) => issue.ruleRefs),
    })

    return {
      ...session,
      simulatedDate: filedAt,
      docketEntries: [...session.docketEntries, rejectionEntry],
    }
  }

  const filingEntry = createDocketEntry(session, {
    filedAt,
    actorRole: draft.participantRole,
    title: event?.label ?? draft.title,
    text:
      event?.docketTextTemplate
        .replace('{participant}', formatParticipant(draft.participantRole))
        .replace('{title}', draft.title) ??
      `${draft.title} filed by ${formatParticipant(draft.participantRole)}.`,
    filingId: filing.id,
    ruleRefs: event?.validationRuleRefs ?? [],
  })

  const updatedSession: CaseSession = {
    ...session,
    simulatedDate: filedAt,
    filings: [...session.filings, filing],
    docketEntries: [...session.docketEntries, filingEntry],
    deadlines: session.deadlines.map((deadline) =>
      deadline.targetEventId === draft.eventId
        ? { ...deadline, status: 'satisfied' }
        : deadline,
    ),
  }

  const newDeadlines =
    event?.deadlineEffects.map((effect) =>
      createDeadline(
        updatedSession,
        effect.label,
        effect.targetEventId,
        filingEntry.id,
        effect.offsetDays,
        effect.sourceRuleRefs,
        draft.eventId,
      ),
    ) ?? []
  const updatedSessionWithDeadlines = {
    ...updatedSession,
    deadlines: [...updatedSession.deadlines, ...newDeadlines],
  }

  if (hasWarnings) {
    const deficiencyEntry = createDocketEntry(updatedSessionWithDeadlines, {
      filedAt: addDays(filedAt, 0),
      actorRole: 'clerk',
      title: 'Clerk Deficiency Notice',
      text: validationIssues.map((issue) => issue.message).join(' '),
      filingId: filing.id,
      ruleRefs: validationIssues.flatMap((issue) => issue.ruleRefs),
    })
    return postProcessAcceptedFiling({
      ...updatedSessionWithDeadlines,
      docketEntries: [...updatedSessionWithDeadlines.docketEntries, deficiencyEntry],
    }, draft)
  }

  return postProcessAcceptedFiling(updatedSessionWithDeadlines, draft)
}

export function validateToolCall(
  session: CaseSession,
  toolCall: ToolCall | RuntimeToolCall,
): ToolValidationResult {
  const courtPack = getCourtPack(session.courtPackId)
  const actor = courtPack.aiActors.find((candidate) => candidate.id === toolCall.actorId)
  const normalized = normalizeToolCall(toolCall)
  const issues: string[] = []

  if (!isImplementedToolName(toolCall.tool)) {
    issues.push(`${toolCall.tool} is not implemented by the simulator runtime.`)
  }

  if (!toolCall.actorId || !actor) {
    issues.push('Actor is not registered for this court pack.')
  } else if (
    isImplementedToolName(toolCall.tool) &&
    !actor.allowedTools.includes(toolCall.tool)
  ) {
    issues.push(`${actor.label} is not authorized to call ${toolCall.tool}.`)
  }

  if (!isImplementedToolName(toolCall.tool)) {
    return { accepted: false, issues }
  }

  if (!normalized) {
    issues.push(`${toolCall.tool} is missing required fields or has malformed fields.`)
    return { accepted: false, issues }
  }

  if (
    ['disposeCase', 'enterJudgment'].includes(normalized.tool) &&
    session.status === 'closed'
  ) {
    issues.push('The case is already closed.')
  }

  if (normalized.tool === 'disposeCase') {
    issues.push(
      ...sessionJurisdictionIssues(session)
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message),
    )
  }

  if (normalized.tool === 'submitToPanel') {
    issues.push(...canSubmitToPanel(session).issues)
  }

  if (normalized.tool === 'fileCounterpartyDocument') {
    const event = getFilingEvent(session.courtPackId, normalized.eventId)
    const participantRole = actorFilingRole(session, normalized.actorId)

    if (!event) {
      issues.push('The AI filing event is not registered for this court pack.')
    } else if (!participantRole || !event.allowedParticipantRoles.includes(participantRole)) {
      issues.push('The AI actor cannot file that event in this court pack.')
    }

    if (normalized.eventId === 'reply_brief') {
      issues.push('The counterparty cannot file appellant reply briefing.')
    }

    if (
      normalized.eventId === 'appellee_brief' &&
      !activeFiledEventSet(session).has('opening_brief')
    ) {
      issues.push('The appellee brief cannot precede the appellant opening brief.')
    }
  }

  if (normalized.tool === 'draftStaffMemo') {
    if (!session.panelAssignment) {
      issues.push('A staff memo requires panel assignment first.')
    }
    if (session.benchMemo) {
      issues.push('A staff memo already exists for this panel deliberation.')
    }
  }

  if (normalized.tool === 'castRuntimePanelVote') {
    const vote: PanelVote = {
      id: `panel_vote_${(session.panelDeliberation?.votes.length ?? 0) + 1}`,
      judgeActorId: normalized.actorId,
      vote: normalized.vote,
      reliefOption: normalized.reliefOption,
      rationale: normalized.rationale,
      joinsMajority: normalized.joinsMajority,
      ...(normalized.separateWritingType
        ? { separateWritingType: normalized.separateWritingType }
        : {}),
      confidence: normalized.confidence,
      createdAt: session.simulatedDate,
    }
    issues.push(...validatePanelVote(session, vote).issues)
  }

  if (normalized.tool === 'draftRuntimePanelDisposition') {
    issues.push(
      ...validatePanelDisposition(session, {
        disposition: normalized.disposition,
        judgmentText: normalized.judgmentText,
        ruleRefs: normalized.ruleRefs,
      }).issues,
    )
  }

  if (normalized.tool === 'enterJudgment') {
    if (!session.panelDisposition) {
      issues.push('Judgment cannot be entered before a validated panel disposition.')
    }
    const ruleIds = new Set(normalized.ruleRefs.map((rule) => rule.ruleId))
    for (const requiredRule of [ruleRefs.frap36, ruleRefs.frap41]) {
      if (!ruleIds.has(requiredRule.ruleId)) {
        issues.push(`Judgment entry must cite ${requiredRule.label}.`)
      }
    }
  }

  return { accepted: issues.length === 0, issues }
}

export function applyToolCall(
  session: CaseSession,
  toolCall: ToolCall | RuntimeToolCall,
): CaseSession {
  const validation = validateToolCall(session, toolCall)
  if (!validation.accepted) {
    const rejectedEntry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'clerk',
      title: 'AI Tool Call Rejected',
      text: validation.issues.join(' '),
      ruleRefs: [ruleRefs.ca4Local45],
    })
    return {
      ...session,
      simulatedDate: rejectedEntry.filedAt,
      docketEntries: [...session.docketEntries, rejectedEntry],
    }
  }

  const normalized = normalizeToolCall(toolCall)

  if (!normalized) {
    return session
  }

  if (normalized.tool === 'issueClerkOrder') {
    const entry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'clerk',
      title: normalized.title,
      text: normalized.text,
      ruleRefs: normalized.ruleRefs,
    })
    return {
      ...session,
      simulatedDate: entry.filedAt,
      docketEntries: [...session.docketEntries, entry],
    }
  }

  if (normalized.tool === 'fileCounterpartyDocument') {
    const event = getFilingEvent(session.courtPackId, normalized.eventId)
    const participantRole = actorFilingRole(session, normalized.actorId) ?? 'appellee'
    const documents = event ? syntheticDocumentsForEvent(event) : []
    const strategicText =
      normalized.eventId === 'appellee_brief'
        ? counterpartyBriefText(session)
        : normalized.text
    const filingDraft: FilingDraft = {
      eventId: normalized.eventId,
      participantRole,
      title: normalized.title,
      documents,
      certificateOfService: true,
      certificateOfCompliance: normalized.eventId.includes('brief'),
      sealed: false,
      notes: strategicText,
    }
    return fileDraft(session, filingDraft)
  }

  if (normalized.tool === 'setDeadline') {
    if (hasOpenDeadline(session, normalized.targetEventId)) {
      const entry = createDocketEntry(session, {
        filedAt: addDays(session.simulatedDate, 1),
        actorRole: 'clerk',
        title: 'Deadline Notice',
        text: `${normalized.label} is already pending on the docket.`,
        ruleRefs: normalized.sourceRuleRefs,
      })
      return {
        ...session,
        simulatedDate: entry.filedAt,
        docketEntries: [...session.docketEntries, entry],
      }
    }

    const sourceEntry = session.docketEntries.at(-1)
    const deadline = createDeadline(
      session,
      normalized.label,
      normalized.targetEventId,
      sourceEntry?.id ?? 'manual',
      normalized.offsetDays,
      normalized.sourceRuleRefs,
      normalized.tool === 'setDeadline'
        ? inferredDeadlineTrigger(normalized.targetEventId)
        : undefined,
    )
    return {
      ...session,
      deadlines: [...session.deadlines, deadline],
    }
  }

  if (normalized.tool === 'submitToPanel') {
    const entry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'clerk',
      title: 'Case Submitted',
      text: normalized.text,
      ruleRefs: [ruleRefs.frap34],
    })
    return assignPanel({
      ...session,
      status: 'submitted',
      procedureState: 'panel_deliberation',
      simulatedDate: entry.filedAt,
      docketEntries: [...session.docketEntries, entry],
    })
  }

  if (normalized.tool === 'draftStaffMemo') {
    const memo = {
      ...createBenchMemo(session),
      authorActorId: normalized.actorId,
      issueSummaries: normalized.issueSummaries,
      recommendedDisposition: normalized.recommendedDisposition,
      risks: normalized.risks,
    }
    const entry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'judge',
      title: 'Staff Attorney Screening Memo',
      text: normalized.text,
      ruleRefs: [ruleRefs.frap34],
    })
    return addBenchMemo(
      {
        ...session,
        simulatedDate: entry.filedAt,
        docketEntries: [...session.docketEntries, entry],
      },
      { ...memo, createdAt: entry.filedAt },
    )
  }

  if (normalized.tool === 'castRuntimePanelVote') {
    const vote: PanelVote = {
      id: `panel_vote_${String((session.panelDeliberation?.votes.length ?? 0) + 1).padStart(4, '0')}`,
      judgeActorId: normalized.actorId,
      vote: normalized.vote,
      reliefOption: normalized.reliefOption,
      rationale: normalized.rationale,
      joinsMajority: normalized.joinsMajority,
      ...(normalized.separateWritingType
        ? { separateWritingType: normalized.separateWritingType }
        : {}),
      confidence: normalized.confidence,
      createdAt: addDays(session.simulatedDate, 1),
    }
    const entry = createDocketEntry(session, {
      filedAt: vote.createdAt,
      actorRole: 'judge',
      title: `Panel Vote Recorded: ${normalized.actorId.replace('ca4_', '').replaceAll('_', ' ')}`,
      text: vote.rationale,
      ruleRefs: [ruleRefs.frap34],
    })
    return addPanelVote(
      {
        ...session,
        simulatedDate: entry.filedAt,
        docketEntries: [...session.docketEntries, entry],
      },
      vote,
    )
  }

  if (normalized.tool === 'draftRuntimePanelDisposition') {
    const disposition = createPanelDisposition(
      session,
      normalized.disposition,
      normalized.judgmentText,
      normalized.ruleRefs,
    )
    const entry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'panel',
      title: normalized.disposition,
      text: normalized.text,
      ruleRefs: normalized.ruleRefs,
    })
    return enterPanelDisposition(
      {
        ...session,
        simulatedDate: entry.filedAt,
        docketEntries: [...session.docketEntries, entry],
      },
      { ...disposition, createdAt: entry.filedAt },
    )
  }

  if (normalized.tool === 'enterJudgment') {
    const dispositionEntry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'panel',
      title: normalized.disposition,
      text: normalized.judgmentText,
      ruleRefs: normalized.ruleRefs,
    })
    const closingSession: CaseSession = {
      ...session,
      status: 'closed',
      procedureState: 'judgment_entered',
      simulatedDate: dispositionEntry.filedAt,
      docketEntries: [...session.docketEntries, dispositionEntry],
      assessment: createAssessment(session, normalized.disposition),
    }
    const rehearingDeadline = createDeadline(
      closingSession,
      'Petition for rehearing due',
      'petition_rehearing',
      dispositionEntry.id,
      14,
      [ruleRefs.frap40],
      'judgment_entered',
    )
    const mandateDeadline = createDeadline(
      { ...closingSession, deadlines: [...closingSession.deadlines, rehearingDeadline] },
      'Mandate expected to issue',
      'mandate',
      dispositionEntry.id,
      21,
      [ruleRefs.frap41],
      'judgment_entered',
    )
    const billOfCostsDeadline = createDeadline(
      {
        ...closingSession,
        deadlines: [...closingSession.deadlines, rehearingDeadline, mandateDeadline],
      },
      'Bill of costs due',
      'bill_of_costs',
      dispositionEntry.id,
      14,
      [ruleRefs.frap39],
      'judgment_entered',
    )
    return {
      ...closingSession,
      deadlines: [
        ...closingSession.deadlines,
        rehearingDeadline,
        mandateDeadline,
        billOfCostsDeadline,
      ],
      panelDeliberation: closingSession.panelDeliberation
        ? { ...closingSession.panelDeliberation, mandateStatus: 'pending' }
        : closingSession.panelDeliberation,
    }
  }

  if (normalized.tool === 'setMandateDeadline') {
    if (hasOpenDeadline(session, 'mandate')) {
      return session
    }
    const sourceEntry = session.docketEntries.at(-1)
    return {
      ...session,
      deadlines: [
        ...session.deadlines,
        createDeadline(
          session,
          normalized.label,
          'mandate',
          sourceEntry?.id ?? 'manual',
          normalized.offsetDays,
          normalized.sourceRuleRefs,
          'judgment_entered',
        ),
      ],
      panelDeliberation: session.panelDeliberation
        ? { ...session.panelDeliberation, mandateStatus: 'pending' }
        : session.panelDeliberation,
    }
  }

  if (normalized.tool === 'issuePanelOrder') {
    const entry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'panel',
      title: normalized.title,
      text: normalized.text,
      ruleRefs: normalized.ruleRefs,
    })
    return {
      ...session,
      simulatedDate: entry.filedAt,
      docketEntries: [...session.docketEntries, entry],
    }
  }

  if (normalized.tool === 'disposeCase') {
    const dispositionEntry = createDocketEntry(session, {
      filedAt: addDays(session.simulatedDate, 1),
      actorRole: 'panel',
      title: normalized.disposition,
      text: normalized.text,
      ruleRefs: normalized.ruleRefs,
    })

    return {
      ...session,
      status: 'closed',
      simulatedDate: dispositionEntry.filedAt,
      docketEntries: [...session.docketEntries, dispositionEntry],
      assessment: createAssessment(session, normalized.disposition),
    }
  }

  return session
}

export function nextExpectedToolCall(session: CaseSession): ToolCall {
  const filedEvents = activeFiledEventSet(session)
  const eventIds = procedureEventIds(session)

  if (!filedEvents.has(eventIds.opening)) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Notice Regarding Case Opening',
      text: 'The proceeding is opened for training purposes. The initiating party must file the required case-opening paper and appearance/disclosure materials before merits briefing proceeds.',
      ruleRefs: [...eventIds.openingRuleRefs, ruleRefs.ca4Local26_1],
    }
  }

  if (!filedEvents.has('appearance_disclosure')) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Directing Disclosure Statement',
      text: 'Appellant is directed to file an appearance and disclosure statement. Failure to comply may delay briefing or result in further order.',
      ruleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
    }
  }

  if (!filedEvents.has(eventIds.docketing)) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Directing Docketing Statement',
      text: 'Appellant must file the docketing statement before merits briefing is scheduled.',
      ruleRefs: eventIds.opening === 'petition_for_review'
        ? [ruleRefs.frap15, ruleRefs.ca4Local15, ruleRefs.ca4Local45]
        : eventIds.opening === 'petition_for_writ_mandamus'
          ? [ruleRefs.frap21, ruleRefs.ca4Local21, ruleRefs.ca4Local45]
          : [ruleRefs.frap3, ruleRefs.ca4Local3, ruleRefs.ca4Local45],
    }
  }

  if (eventIds.extra && !filedEvents.has(eventIds.extra)) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Regarding CJA Financial Disclosure',
      text: 'Appellant must file the required financial disclosure or CJA-related statement before criminal briefing is scheduled.',
      ruleRefs: [ruleRefs.frap9, ruleRefs.ca4Local9],
    }
  }

  if (!filedEvents.has(eventIds.record)) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: eventIds.record === 'certified_agency_record'
        ? 'Clerk Order Regarding Agency Record'
        : eventIds.record === 'appendix_to_writ_petition'
          ? 'Clerk Order Regarding Writ Appendix'
          : 'Clerk Order Regarding Transcript Order',
      text: eventIds.record === 'certified_agency_record'
        ? 'The agency record, certified list, or record-complete signal must be filed before merits briefing is scheduled.'
        : eventIds.record === 'appendix_to_writ_petition'
          ? 'The writ petition requires essential orders or record excerpts before the petition can be screened for answer or disposition.'
          : 'Appellant must file a transcript order acknowledgment or confirm that no transcript is necessary before merits briefing is scheduled.',
      ruleRefs: eventIds.record === 'certified_agency_record'
        ? [ruleRefs.frap16, ruleRefs.frap17]
        : eventIds.record === 'appendix_to_writ_petition'
          ? [ruleRefs.frap21, ruleRefs.ca4Local21]
          : [ruleRefs.frap10, ruleRefs.ca4Local10, ruleRefs.ca4Local11],
    }
  }

  if (session.courtPackId.includes('original-writ')) {
    if (!filedEvents.has('answer_to_writ_petition')) {
      return {
        tool: 'setDeadline',
        actorId: 'ca4_clerk',
        label: 'Answer to writ petition due',
        targetEventId: 'answer_to_writ_petition',
        offsetDays: 14,
        sourceRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      }
    }
    if (!filedEvents.has('reply_in_support_of_writ')) {
      return {
        tool: 'issueClerkOrder',
        actorId: 'ca4_clerk',
        title: 'Writ Reply Notice',
        text: 'The answer to the writ petition has been filed. Petitioner may file any permitted reply before the petition package is submitted to the panel.',
        ruleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      }
    }
    return {
      tool: 'submitToPanel',
      actorId: 'ca4_clerk',
      text: 'The writ petition, appendix, answer, and reply are complete. The petition is submitted to the panel for disposition.',
    }
  }

  if (!filedEvents.has('opening_brief')) {
    if (hasOpenDeadline(session, eventIds.openingDeadline.targetEventId)) {
      return {
        tool: 'issueClerkOrder',
        actorId: 'ca4_clerk',
        title: 'Briefing Schedule Pending',
        text: 'The opening brief and appendix deadline is already open. Appellant must file the opening brief rather than request another schedule.',
        ruleRefs: eventIds.openingDeadline.sourceRuleRefs,
      }
    }

    return {
      tool: 'setDeadline',
      actorId: 'ca4_clerk',
      label: eventIds.openingDeadline.label,
      targetEventId: eventIds.openingDeadline.targetEventId,
      offsetDays: eventIds.openingDeadline.offsetDays,
      sourceRuleRefs: eventIds.openingDeadline.sourceRuleRefs,
    }
  }

  if (!filedEvents.has('joint_appendix')) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Regarding Appendix',
      text: 'The opening brief has been received, but the joint appendix has not been filed. Appellant must cure the appendix deficiency before the case is submitted.',
      ruleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    }
  }

  if (!filedEvents.has('appellee_brief')) {
    return {
      tool: 'fileCounterpartyDocument',
      actorId: 'appellee_ai',
      eventId: 'appellee_brief',
      title: 'Appellee Brief',
      text: 'Appellee files a brief defending summary judgment and arguing that appellant failed to preserve several evidentiary objections.',
    }
  }

  if (!filedEvents.has('reply_brief')) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Briefing Notice',
      text: 'Appellant may file a reply brief within the example deadline. The case will be eligible for panel submission after briefing is complete.',
      ruleRefs: [ruleRefs.frap31],
    }
  }

  if (session.status === 'active') {
    return {
      tool: 'submitToPanel',
      actorId: 'ca4_clerk',
      text: 'Briefing is complete. The case is submitted to the three-judge panel without oral argument for this simulation run.',
    }
  }

  if (session.status === 'submitted' && !session.benchMemo) {
    const memo = createBenchMemo(session)
    return {
      tool: 'draftStaffMemo',
      actorId: 'ca4_staff_attorney',
      text: memo.issueSummaries.join(' '),
      issueSummaries: memo.issueSummaries,
      recommendedDisposition: memo.recommendedDisposition,
      risks: memo.risks,
    }
  }

  if (session.status === 'submitted' && (session.panelDeliberation?.votes.length ?? 0) < 3) {
    const judgeActorId = nextPanelJudgeActorId(session) ?? 'ca4_judge_1'
    const vote = deterministicPanelVote(session, judgeActorId)
    return {
      tool: 'castRuntimePanelVote',
      actorId: vote.judgeActorId,
      vote: vote.vote,
      reliefOption: vote.reliefOption,
      rationale: vote.rationale,
      joinsMajority: vote.joinsMajority,
      ...(vote.separateWritingType ? { separateWritingType: vote.separateWritingType } : {}),
      confidence: vote.confidence,
    }
  }

  if (session.status === 'submitted' && !session.panelDisposition) {
    const disposition = createPanelDisposition(session)
    return {
      tool: 'draftRuntimePanelDisposition',
      actorId: 'ca4_panel',
      disposition: disposition.disposition,
      text: disposition.judgmentText,
      judgmentText: disposition.judgmentText,
      ruleRefs: disposition.ruleRefs,
    }
  }

  return {
    tool: 'enterJudgment',
    actorId: 'ca4_panel',
    disposition: session.panelDisposition?.disposition ?? 'Opinion and Judgment',
    judgmentText:
      session.panelDisposition?.judgmentText ??
      'Judgment is entered and the mandate will issue under the simulated schedule unless stayed.',
    ruleRefs: [ruleRefs.frap36, ruleRefs.frap41],
  }
}

export function createAssessment(session: CaseSession, disposition: string): Assessment {
  const rejectedEntryCount = session.docketEntries.filter(
    (entry) => entry.title === 'Clerk Notice of Rejected Filing',
  ).length
  const deficiencyFilings = session.filings.filter(
    (filing) => filing.outcome === 'accepted_with_deficiency',
  )
  const filedEvents = activeFiledEventSet(session)
  const score =
    100 -
    rejectedEntryCount * 20 -
    deficiencyFilings.length * 10 -
    (filedEvents.has('joint_appendix') ? 0 : 12) -
    (filedEvents.has('appearance_disclosure') ? 0 : 10)

  return {
    disposition,
    score: Math.max(0, score),
    proceduralFindings: [
      rejectedEntryCount
        ? `${rejectedEntryCount} filing was rejected before reaching the docket.`
        : 'No filing was rejected outright.',
      deficiencyFilings.length
        ? `${deficiencyFilings.length} accepted filing generated a clerk deficiency notice.`
        : 'No accepted filing generated a deficiency notice.',
      filedEvents.has('appearance_disclosure')
        ? 'Appearance and disclosure obligations were satisfied.'
        : 'Appearance and disclosure obligations should be handled before merits briefing.',
      filedEvents.has('joint_appendix')
        ? 'Appendix practice was handled before submission.'
        : 'The appendix issue remained a procedural weakness.',
    ],
    meritsFindings: [
      'The strongest merits path was the comparator-evidence argument under the summary judgment standard.',
      'The weakest merits path was the late evidentiary objection, which should have been preserved and developed earlier.',
      'The panel response tracks both procedure and merits; procedural omissions reduced available relief.',
    ],
    nextPracticeTargets: [
      'File the appearance/disclosure statement before briefing.',
      'Pair the opening brief with the required appendix workflow.',
      'Use motions only when the requested relief is procedurally available.',
      'Preserve every issue in the opening brief with record citations.',
    ],
  }
}
