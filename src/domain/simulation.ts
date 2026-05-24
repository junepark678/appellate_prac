import { getCourtPack, getFilingEvent, getScenario, openingBriefDeadline, ruleRefs } from './packs'
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
  ToolCall,
  ToolValidationResult,
  UploadedDocument,
  ValidationIssue,
} from './types'

const simulatorStart = '2026-05-23T09:00:00.000Z'
const implementedToolNames = new Set([
  'issueClerkOrder',
  'fileCounterpartyDocument',
  'setDeadline',
  'submitToPanel',
  'issuePanelOrder',
  'disposeCase',
])

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
): Deadline {
  return {
    id: makeId('deadline', session.deadlines.length),
    label,
    dueDate: addDays(session.simulatedDate, offsetDays),
    targetEventId,
    sourceEntryId,
    status: 'open',
    sourceRuleRefs,
  }
}

function isImplementedToolName(tool: string): tool is ToolCall['tool'] {
  return implementedToolNames.has(tool)
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

  return null
}

function activeFilings(session: CaseSession) {
  return session.filings.filter((filing) => filing.outcome !== 'rejected')
}

function activeFiledEventSet(session: CaseSession) {
  return new Set(activeFilings(session).map((filing) => filing.eventId))
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
      event.label.toLowerCase(),
    ],
  }))
}

export function createInitialSession(scenarioId = 'synthetic-employment-retaliation'): CaseSession {
  const scenario = getScenario(scenarioId)
  const courtPack = getCourtPack(scenario.courtPackId)
  const participants: Participant[] = [
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

  const session: CaseSession = {
    id: 'case_0001',
    scenario,
    courtPackId: scenario.courtPackId,
    status: 'active',
    simulatedDate: simulatorStart,
    participants,
    docketEntries: [],
    deadlines: [],
    filings: [],
  }

  const openingEntry = createDocketEntry(session, {
    filedAt: session.simulatedDate,
    actorRole: 'district_court',
    title: 'Civil Appeal Opened',
    text: `${scenario.shortCaption}. Appeal docketed from ${scenario.lowerTribunal}. Record transmitted for simulator purposes.`,
    ruleRefs: [ruleRefs.frap3],
  })

  return {
    ...session,
    docketEntries: [openingEntry],
    deadlines: [
      createDeadline(
        session,
        'Notice of appeal due',
        'notice_of_appeal',
        openingEntry.id,
        30,
        [ruleRefs.frap4],
      ),
    ],
  }
}

export function inferDocumentSignals(file: File): UploadedDocument {
  const normalizedName = file.name.toLowerCase()
  const extractedSignals = [
    normalizedName.includes('notice') ? 'notice of appeal' : '',
    normalizedName.includes('disclosure') ? 'disclosure' : '',
    normalizedName.includes('motion') ? 'motion' : '',
    normalizedName.includes('response') ? 'response' : '',
    normalizedName.includes('reply') ? 'reply' : '',
    normalizedName.includes('brief') ? 'argument' : '',
    normalizedName.includes('appendix') ? 'appendix' : '',
    normalizedName.includes('amicus') ? 'amicus' : '',
    normalizedName.includes('rehearing') ? 'rehearing' : '',
  ].filter(Boolean)

  return {
    id: `${file.name}-${file.lastModified}`,
    fileName: file.name,
    mimeType: file.type || 'application/pdf',
    sizeBytes: file.size,
    extractedSignals,
  }
}

export function validateFiling(
  session: CaseSession,
  draft: FilingDraft,
): ValidationIssue[] {
  const courtPack = getCourtPack(session.courtPackId)
  const event = getFilingEvent(session.courtPackId, draft.eventId)
  const issues: ValidationIssue[] = []

  if (!event) {
    return [
      {
        severity: 'error',
        message: 'The selected filing event is not available in this court pack.',
        ruleRefs: [],
      },
    ]
  }

  if (!event.allowedCourtLevels.includes(courtPack.courtLevel)) {
    issues.push({
      severity: 'error',
      message: `${event.label} is not available at this court level.`,
      ruleRefs: event.validationRuleRefs,
    })
  }

  if (!event.allowedParticipantRoles.includes(draft.participantRole)) {
    issues.push({
      severity: 'error',
      message: `${formatParticipant(draft.participantRole)} cannot file ${event.label} in this posture.`,
      ruleRefs: event.validationRuleRefs,
    })
  }

  const unmatchedDocuments = [...draft.documents]

  for (const requirement of event.requiredDocuments) {
    const matchingIndex = unmatchedDocuments.findIndex((document) =>
      requirement.acceptedMimeTypes.includes(document.mimeType),
    )
    const matchingDocument =
      matchingIndex >= 0 ? unmatchedDocuments.splice(matchingIndex, 1)[0] : undefined

    if (!matchingDocument) {
      issues.push({
        severity: 'error',
        message: `${requirement.label} is required.`,
        ruleRefs: event.validationRuleRefs,
      })
      continue
    }

    if (matchingDocument.sizeBytes > 25 * 1024 * 1024) {
      issues.push({
        severity: 'warning',
        message: `${matchingDocument.fileName} is large enough that a real filing system may require extra handling.`,
        ruleRefs: [ruleRefs.frap25],
      })
    }

    if (
      typeof requirement.maxPages === 'number' &&
      typeof matchingDocument.pageCount === 'number' &&
      matchingDocument.pageCount > requirement.maxPages
    ) {
      issues.push({
        severity: 'error',
        message: `${matchingDocument.fileName} exceeds the ${requirement.maxPages}-page simulator limit for ${requirement.label}.`,
        ruleRefs: event.validationRuleRefs,
      })
    }

    for (const signal of requirement.mustContain ?? []) {
      if (!matchingDocument.extractedSignals.includes(signal)) {
        issues.push({
          severity: 'warning',
          message: `${requirement.label} does not show a "${signal}" signal in the filename/text extraction stub.`,
          ruleRefs: event.validationRuleRefs,
        })
      }
    }
  }

  if (!draft.certificateOfService) {
    issues.push({
      severity: 'error',
      message: 'Certificate of service is missing.',
      ruleRefs: [ruleRefs.frap25],
    })
  }

  if (
    ['opening_brief', 'appellee_brief', 'reply_brief', 'amicus_brief'].includes(
      draft.eventId,
    ) &&
    !draft.certificateOfCompliance
  ) {
    issues.push({
      severity: 'error',
      message: 'Certificate of compliance is missing for this brief.',
      ruleRefs: [ruleRefs.frap32],
    })
  }

  if (
    draft.eventId === 'opening_brief' &&
    !activeFiledEventSet(session).has('appearance_disclosure')
  ) {
    issues.push({
      severity: 'warning',
      message:
        'Opening brief is being filed before an appellant appearance/disclosure statement appears on the docket.',
      ruleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local12],
    })
  }

  if (
    draft.eventId === 'opening_brief' &&
    !activeFiledEventSet(session).has('joint_appendix')
  ) {
    issues.push({
      severity: 'warning',
      message:
        'Opening brief is being filed before the joint appendix appears on the docket.',
      ruleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    })
  }

  if (
    draft.eventId === 'reply_brief' &&
    !activeFiledEventSet(session).has('appellee_brief')
  ) {
    issues.push({
      severity: 'error',
      message: 'A reply brief cannot precede the appellee brief.',
      ruleRefs: [ruleRefs.frap31],
    })
  }

  if (session.status === 'closed' && draft.eventId !== 'petition_rehearing') {
    issues.push({
      severity: 'error',
      message: 'Only authorized post-disposition filings are available after closure.',
      ruleRefs: [ruleRefs.frap40, ruleRefs.frap41],
    })
  }

  const openDeadline = session.deadlines.find(
    (deadline) => deadline.targetEventId === draft.eventId && deadline.status === 'open',
  )
  if (openDeadline && new Date(session.simulatedDate) > new Date(openDeadline.dueDate)) {
    issues.push({
      severity: 'warning',
      message: `${event.label} appears after the open example deadline.`,
      ruleRefs: openDeadline.sourceRuleRefs,
    })
  }

  return issues
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

  if (hasWarnings) {
    const deficiencyEntry = createDocketEntry(updatedSession, {
      filedAt: addDays(filedAt, 0),
      actorRole: 'clerk',
      title: 'Clerk Deficiency Notice',
      text: validationIssues.map((issue) => issue.message).join(' '),
      filingId: filing.id,
      ruleRefs: validationIssues.flatMap((issue) => issue.ruleRefs),
    })
    return {
      ...updatedSession,
      docketEntries: [...updatedSession.docketEntries, deficiencyEntry],
    }
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
      ),
    ) ?? []

  return {
    ...updatedSession,
    deadlines: [...updatedSession.deadlines, ...newDeadlines],
  }
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

  if (normalized.tool === 'disposeCase' && session.status === 'closed') {
    issues.push('The case is already closed.')
  }

  if (
    normalized.tool === 'submitToPanel' &&
    !activeFiledEventSet(session).has('reply_brief')
  ) {
    issues.push('The panel submission tool requires the normal briefing sequence first.')
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
    const filingDraft: FilingDraft = {
      eventId: normalized.eventId,
      participantRole,
      title: normalized.title,
      documents,
      certificateOfService: true,
      certificateOfCompliance: normalized.eventId.includes('brief'),
      sealed: false,
      notes: normalized.text,
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
    return {
      ...session,
      status: 'submitted',
      simulatedDate: entry.filedAt,
      docketEntries: [...session.docketEntries, entry],
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

  if (!filedEvents.has('notice_of_appeal')) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Notice Regarding Case Opening',
      text: 'The appeal is opened for training purposes. Appellant must file a notice of appeal and required appearance/disclosure materials before merits briefing proceeds.',
      ruleRefs: [ruleRefs.frap3, ruleRefs.frap4, ruleRefs.ca4Local12],
    }
  }

  if (!filedEvents.has('appearance_disclosure')) {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Directing Disclosure Statement',
      text: 'Appellant is directed to file an appearance and disclosure statement. Failure to comply may delay briefing or result in further order.',
      ruleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local12],
    }
  }

  if (!filedEvents.has('opening_brief')) {
    if (hasOpenDeadline(session, openingBriefDeadline.targetEventId)) {
      return {
        tool: 'issueClerkOrder',
        actorId: 'ca4_clerk',
        title: 'Briefing Schedule Pending',
        text: 'The opening brief and appendix deadline is already open. Appellant must file the opening brief rather than request another schedule.',
        ruleRefs: openingBriefDeadline.sourceRuleRefs,
      }
    }

    return {
      tool: 'setDeadline',
      actorId: 'ca4_clerk',
      label: openingBriefDeadline.label,
      targetEventId: openingBriefDeadline.targetEventId,
      offsetDays: openingBriefDeadline.offsetDays,
      sourceRuleRefs: openingBriefDeadline.sourceRuleRefs,
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

  return {
    tool: 'disposeCase',
    actorId: 'ca4_panel',
    disposition: 'Opinion and Judgment',
    text: 'The judgment is vacated in part and remanded. The panel concludes that the district court applied the correct summary judgment standard but failed to view comparator evidence in the light most favorable to appellant. Appellant forfeited a separate evidentiary objection by failing to develop it in the opening brief.',
    ruleRefs: [ruleRefs.frap28, ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
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
