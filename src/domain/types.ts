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

export type UserRole = 'student' | 'admin' | 'instructor'

export type InstitutionRole = 'learner' | 'instructor' | 'admin'

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

export type ProcedureState =
  | 'case_opened'
  | 'notice_pending'
  | 'jurisdiction_review'
  | 'appearance_pending'
  | 'fee_or_ifp_pending'
  | 'record_pending'
  | 'briefing_schedule_pending'
  | 'opening_brief_pending'
  | 'appendix_pending'
  | 'appellee_brief_pending'
  | 'reply_brief_pending'
  | 'motion_pending'
  | 'submitted'
  | 'panel_deliberation'
  | 'judgment_entered'
  | 'rehearing_pending'
  | 'mandate_pending'
  | 'closed'
  | 'dismissed'

export type FilingOutcome =
  | 'accepted'
  | 'accepted_with_deficiency'
  | 'rejected'
  | 'referred_to_panel'
  | 'lodged_pending_review'

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
      | 'fee_or_ifp'
      | 'privacy_redaction'
      | 'sealed_filing'
      | 'attachment_type'
      | 'brief_content_section'
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
  | 'recommendClerkAction'
  | 'draftClerkOrder'
  | 'draftCounterpartyFiling'
  | 'recommendAmicusParticipation'
  | 'draftBenchMemo'
  | 'castPanelVote'
  | 'draftPanelDisposition'
  | 'draftAssessmentFeedback'

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
  extractedText?: string
  extractedSignals: string[]
}

export type FilingAttachment = {
  id: string
  label: string
  document: UploadedDocument
  attachmentType: 'main' | 'appendix' | 'exhibit' | 'certificate' | 'motion_attachment' | 'other'
}

export type FilingMetadata = {
  representedPartyId?: string
  reliefRequested?: string
  serviceMethod: 'cm_ecf' | 'mail' | 'email' | 'hand_delivery' | 'none'
  relatedDocketEntryId?: string
  emergency: boolean
  sealed: boolean
  redactionAcknowledged: boolean
  certificateOfService: boolean
  certificateOfCompliance: boolean
}

export type FilingSubmission = {
  eventId: string
  participantRole: ParticipantRole
  title: string
  mainDocument: UploadedDocument
  attachments: FilingAttachment[]
  metadata: FilingMetadata
  notes: string
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
  code?: string
  cureSuggestion?: string
}

export type PreflightCheckResult = {
  accepted: boolean
  outcome: FilingOutcome
  issues: ValidationIssue[]
  analyzedAt: string
}

export type FilingRecord = FilingDraft & {
  id: string
  filedAt: string
  outcome: FilingOutcome
  validationIssues: ValidationIssue[]
  submissionJson?: string
  documentAnalysisIds?: string[]
}

export type EcfReceipt = {
  id: string
  caseSessionId: string
  filingId: string
  receiptNumber: string
  noticeOfDocketActivityText: string
  serviceList: string[]
  createdAt: string
}

export type NoticeOfDocketActivity = {
  receiptNumber: string
  docketText: string
  recipients: string[]
  generatedAt: string
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
  procedureState?: ProcedureState
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
  | {
      tool: 'recommendClerkAction'
      actorId: string
      recommendation: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'draftClerkOrder'
      actorId: string
      title: string
      text: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'draftCounterpartyFiling'
      actorId: string
      eventId: string
      title: string
      text: string
    }
  | {
      tool: 'recommendAmicusParticipation'
      actorId: string
      organizationType: string
      rationale: string
      requiresLeave: boolean
    }
  | {
      tool: 'draftBenchMemo'
      actorId: string
      issueSummary: string
      recommendation: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'castPanelVote'
      actorId: string
      vote: string
      reliefOption: string
      rationale: string
      confidence: number
    }
  | {
      tool: 'draftPanelDisposition'
      actorId: string
      disposition: string
      text: string
      reliefOption: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'draftAssessmentFeedback'
      actorId: string
      proceduralFindings: string[]
      meritsFindings: string[]
      nextPracticeTargets: string[]
    }

export type ToolValidationResult = {
  accepted: boolean
  issues: string[]
}

export type DocketEffect = {
  type: 'docket_entry'
  actorRole: ParticipantRole
  title: string
  text: string
  filingId?: string
  ruleRefs: RuleRef[]
}

export type DeadlineEffectResult = {
  type: 'deadline'
  label: string
  targetEventId: string
  offsetDays: number
  sourceRuleRefs: RuleRef[]
}

export type StateTransitionResult = {
  accepted: boolean
  fromState: ProcedureState
  toState: ProcedureState
  warnings: string[]
  docketEffects: DocketEffect[]
  deadlineEffects: DeadlineEffectResult[]
}

export type PanelJudgeVote = {
  actorModuleId: string
  vote: string
  reliefOption: string
  rationale: string
  confidence: number
  createdAt: string
}

export type PanelDisposition = {
  disposition: string
  reliefOption: string
  text: string
  votes: PanelJudgeVote[]
  ruleRefs: RuleRef[]
}

export type IssueEvaluation = {
  issueId: string
  label: string
  standardOfReview: string
  preservationStatus: 'preserved' | 'forfeited' | 'waived' | 'unclear'
  waiverOrForfeitureRisk: 'low' | 'medium' | 'high'
  recordSupport: 'strong' | 'mixed' | 'weak' | 'missing'
  harmlessErrorPosture: 'not_applicable' | 'harmless_likely' | 'prejudicial_possible'
  requestedRelief: string[]
}

export type ReliefEvaluation = {
  availableRelief: string[]
  barredRelief: string[]
  reasons: string[]
}
