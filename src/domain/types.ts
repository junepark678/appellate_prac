export type CourtSystem = 'federal' | 'state' | 'territorial' | 'administrative'

export type CourtLevel =
  | 'trial'
  | 'intermediate_appellate'
  | 'highest_appellate'
  | 'specialized'
  | 'agency'

export type ProcedureDomain =
  | 'civil_trial'
  | 'civil_appeal'
  | 'criminal_trial'
  | 'criminal_appeal'
  | 'agency_review'
  | 'bankruptcy_appeal'
  | 'original_writ'
  | 'post_judgment'

export type ParticipantRole =
  | 'appellant'
  | 'appellee'
  | 'amicus'
  | 'clerk'
  | 'panel'
  | 'district_court'
  | 'plaintiff'
  | 'defendant'
  | 'judge'
  | 'agency'

export type CaseStatus =
  | 'setup'
  | 'active'
  | 'submitted'
  | 'closed'
  | 'dismissed'

export type FilingOutcome =
  | 'accepted'
  | 'accepted_with_deficiency'
  | 'rejected'
  | 'referred_to_panel'

export type DeadlineStatus = 'open' | 'satisfied' | 'missed' | 'vacated'

export type AiActorRole =
  | 'clerk'
  | 'opposing_party'
  | 'judge'
  | 'panel'
  | 'agency'
  | 'amicus'
  | 'mediator'

export type RuleRef = {
  ruleId: string
  label: string
  sourceUrl: string
}

export type StructuredConstraint = {
  kind:
    | 'required_document'
    | 'deadline'
    | 'word_limit'
    | 'page_limit'
    | 'certificate'
    | 'service'
    | 'jurisdiction'
    | 'event_sequence'
  value: string
}

export type RuleItem = {
  jurisdiction: string
  ruleId: string
  topic: string
  effectiveFrom: string
  effectiveTo?: string
  sourceLabel: string
  sourceUrl: string
  plainText: string
  structuredConstraints: StructuredConstraint[]
  simulatorNotes: string
}

export type RulePack = {
  id: string
  moduleId?: string
  label: string
  courtSystem: CourtSystem
  courtLevel?: CourtLevel
  procedureDomain?: ProcedureDomain
  version: string
  sourceUrl: string
  sourceVersionIds?: string[]
  items: RuleItem[]
}

export type DocumentRequirement = {
  id: string
  label: string
  required: boolean
  acceptedMimeTypes: string[]
  maxPages?: number
  mustContain?: string[]
}

export type FilingEvent = {
  id: string
  label: string
  domain: ProcedureDomain
  allowedCourtLevels: CourtLevel[]
  allowedParticipantRoles: ParticipantRole[]
  requiredDocuments: DocumentRequirement[]
  optionalDocuments: DocumentRequirement[]
  validationRuleRefs: RuleRef[]
  deadlineEffects: DeadlineEffect[]
  docketTextTemplate: string
  possibleClerkResponses: string[]
}

export type DeadlineEffect = {
  targetEventId: string
  offsetDays: number
  label: string
  sourceRuleRefs: RuleRef[]
}

export type AiToolName =
  | 'proposeDocketEntry'
  | 'issueClerkOrder'
  | 'setDeadline'
  | 'rejectFiling'
  | 'acceptFiling'
  | 'requestResponse'
  | 'fileCounterpartyDocument'
  | 'inviteOrDenyAmicus'
  | 'submitToPanel'
  | 'issuePanelOrder'
  | 'disposeCase'
  | 'generatePostCaseAssessment'

export type AiActor = {
  id: string
  label: string
  role: AiActorRole
  count?: number
  authorityScope: string[]
  allowedTools: AiToolName[]
}

export type CourtPack = {
  id: string
  moduleId?: string
  label: string
  courtSystem: CourtSystem
  courtLevel: CourtLevel
  procedureDomain: ProcedureDomain
  baseCourtPackIds: string[]
  includedRulePackIds: string[]
  rulePackIds: string[]
  procedureModuleIds?: string[]
  participantRoles: ParticipantRole[]
  filingEvents: FilingEvent[]
  aiActors: AiActor[]
  docketNumberFormat: string
}

export type Participant = {
  id: string
  displayName: string
  role: ParticipantRole
}

export type UploadedDocument = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  pageCount?: number
  extractedSignals: string[]
}

export type FilingDraft = {
  eventId: string
  participantRole: ParticipantRole
  title: string
  documents: UploadedDocument[]
  certificateOfService: boolean
  certificateOfCompliance: boolean
  sealed: boolean
  notes: string
}

export type ValidationIssue = {
  severity: 'error' | 'warning' | 'info'
  message: string
  ruleRefs: RuleRef[]
}

export type FilingRecord = FilingDraft & {
  id: string
  filedAt: string
  outcome: FilingOutcome
  validationIssues: ValidationIssue[]
  submissionJson?: string
  documentAnalysisIds?: string[]
}

export type DocketEntry = {
  id: string
  entryNumber: number
  filedAt: string
  actorRole: ParticipantRole
  title: string
  text: string
  filingId?: string
  ruleRefs: RuleRef[]
}

export type Deadline = {
  id: string
  label: string
  dueDate: string
  targetEventId: string
  sourceEntryId: string
  status: DeadlineStatus
  sourceRuleRefs: RuleRef[]
}

export type Scenario = {
  id: string
  title: string
  source: 'synthetic' | 'recap_import' | 'generated_from_import'
  courtPackId: string
  shortCaption: string
  lowerTribunal: string
  natureOfSuit: string
  proceduralPosture: string
  issuesPresented: string[]
  meritsRecord: string[]
  sourceCaseUrl?: string
}

export type CaseSession = {
  id: string
  scenario: Scenario
  courtPackId: string
  status: CaseStatus
  simulatedDate: string
  participants: Participant[]
  docketEntries: DocketEntry[]
  deadlines: Deadline[]
  filings: FilingRecord[]
  assessment?: Assessment
}

export type Assessment = {
  rubricId?: string
  disposition: string
  score: number
  scoreBreakdownJson?: string
  proceduralFindings: string[]
  meritsFindings: string[]
  nextPracticeTargets: string[]
}

export type ToolCall =
  | {
      tool: 'issueClerkOrder'
      actorId: string
      title: string
      text: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'fileCounterpartyDocument'
      actorId: string
      eventId: string
      title: string
      text: string
    }
  | {
      tool: 'setDeadline'
      actorId: string
      label: string
      targetEventId: string
      offsetDays: number
      sourceRuleRefs: RuleRef[]
    }
  | {
      tool: 'submitToPanel'
      actorId: string
      text: string
    }
  | {
      tool: 'issuePanelOrder'
      actorId: string
      title: string
      text: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'disposeCase'
      actorId: string
      disposition: string
      text: string
      ruleRefs: RuleRef[]
    }

export type ToolValidationResult = {
  accepted: boolean
  issues: string[]
}
