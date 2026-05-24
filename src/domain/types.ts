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
  | 'docketing_statement_pending'
  | 'record_ordering_pending'
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

export type EcfEventCategory =
  | 'case_opening'
  | 'appearance'
  | 'brief'
  | 'appendix'
  | 'motion'
  | 'response'
  | 'sealed'
  | 'post_disposition'
  | 'amicus'

export type EcfFeeBehavior = 'none' | 'required' | 'waivable' | 'deferred'

export type EcfServiceBehavior = 'cm_ecf' | 'manual_required' | 'mixed'

export type EcfPartySelectionMode = 'none' | 'single' | 'multiple' | 'all_filers'

export type FilingEvent = {
  id: string
  label: string
  domain: ProcedureDomain
  allowedCourtLevels: CourtLevel[]
  allowedParticipantRoles: ParticipantRole[]
  ecfMenuPath: string[]
  ecfCategory: EcfEventCategory
  courtEventCode: string
  requiresRelatedEntry: boolean
  requiresReliefText: boolean
  feeBehavior: EcfFeeBehavior
  serviceBehavior: EcfServiceBehavior
  partySelectionMode: EcfPartySelectionMode
  receiptTemplateId: string
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
  | 'draftStaffMemo'
  | 'castRuntimePanelVote'
  | 'draftRuntimePanelDisposition'
  | 'enterJudgment'
  | 'setMandateDeadline'
  | 'generatePostCaseAssessment'
  | 'recommendClerkAction'
  | 'draftClerkOrder'
  | 'analyzeAppellantFiling'
  | 'draftCounterpartyStrategy'
  | 'fileResponsiveMotion'
  | 'fileAppelleeBrief'
  | 'opposeMotion'
  | 'respondToRehearing'
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
  storageId?: string
  sha256?: string
  pageCount?: number
  extractedText?: string
  textExtractionStatus?: 'not_started' | 'extracted' | 'not_searchable' | 'failed' | 'fallback'
  wordCount?: number
  analysisId?: string
  analysis?: import('../modules/types').DocumentAnalysis
  extractedSignals: string[]
}

export type FilingAttachment = {
  id: string
  label: string
  document: UploadedDocument
  attachmentType: 'main' | 'appendix' | 'exhibit' | 'certificate' | 'motion_attachment' | 'other'
}

export type FilingMetadata = {
  filingAttorneyName?: string
  representedPartyId?: string
  feePaymentStatus?: 'not_required' | 'paid' | 'deferred' | 'waived' | 'pending'
  reliefRequested?: string
  serviceMethod: 'cm_ecf' | 'mail' | 'email' | 'hand_delivery' | 'none'
  relatedDocketEntryId?: string
  consentStatus?: 'all_parties_consent' | 'partial_consent' | 'no_consent' | 'unknown'
  sealedDocumentType?: string
  privacyAcknowledged?: boolean
  publicRedactedVersionIncluded?: boolean
  serviceListOverrides?: {
    additionalRecipients?: string[]
    suppressedParticipantIds?: string[]
    manualServiceRecipients?: string[]
  }
  feeWaiverRequested?: boolean
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
  filedTimestamp?: string
  filer?: ParticipantRole
  eventId?: string
  documentList?: Array<{
    fileName: string
    attachmentType: FilingAttachment['attachmentType'] | 'main'
    sizeBytes: number
  }>
  noticeOfDocketActivityText: string
  serviceList: string[]
  docketText?: string
  warnings?: string[]
  deficiencies?: string[]
  nextExpectedDeadline?: {
    label: string
    dueDate: string
    targetEventId: string
  }
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
  issues?: ScenarioIssue[]
  recordExcerpts?: ScenarioRecordExcerpt[]
  training?: ScenarioTrainingMetadata
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
  ecfReceipts?: EcfReceipt[]
  counterpartyStrategy?: CounterpartyStrategy
  amicusParticipation?: AmicusParticipation
  panelAssignment?: PanelAssignment
  benchMemo?: BenchMemo
  panelDeliberation?: PanelDeliberation
  panelDisposition?: PanelDispositionRecord
  assessment?: Assessment
  actorWorkProducts?: ActorWorkProduct[]
}

export type ActorWorkProductKind =
  | 'counterparty_strategy'
  | 'counterparty_filing_draft'
  | 'amicus_recommendation'
  | 'amicus_filing_draft'
  | 'bench_memo'
  | 'judge_vote_memo'
  | 'panel_disposition_draft'
  | 'assessment_feedback'

export type ActorWorkProductStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'superseded'

export type ActorCitation = {
  id: string
  label: string
  sourceType:
    | 'filing'
    | 'document_analysis'
    | 'rule'
    | 'record_excerpt'
    | 'docket_entry'
  sourceId?: string
  ruleRef?: RuleRef
  quote?: string
  pin?: string
}

export type GeneratedFilingDraft = {
  eventId: string
  participantRole: ParticipantRole
  title: string
  documentFileName: string
  documentText: string
  attachmentTexts?: Array<{
    label: string
    fileName: string
    text: string
    attachmentType: FilingAttachment['attachmentType']
  }>
  certificateOfService: boolean
  certificateOfCompliance: boolean
  sealed: boolean
  notes: string
  citations: ActorCitation[]
  ruleRefs: RuleRef[]
}

export type ActorReasoningMemo = {
  title: string
  summary: string
  reasoning: string[]
  recommendations: string[]
  citations: ActorCitation[]
  ruleRefs: RuleRef[]
  proceduralClaims?: string[]
  requestedDisposition?: string
  reliefOption?: string
  confidence?: number
}

export type ActorWorkProduct = {
  id: string
  caseSessionId: string
  actorId: string
  kind: ActorWorkProductKind
  status: ActorWorkProductStatus
  workProduct: GeneratedFilingDraft | ActorReasoningMemo
  sourceDocumentAnalysisIds: string[]
  sourceFilingIds: string[]
  createdAt: string
  validationIssues?: ValidationIssue[]
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
      tool: 'draftStaffMemo'
      actorId: string
      text: string
      issueSummaries: string[]
      recommendedDisposition: string
      risks: string[]
    }
  | {
      tool: 'castRuntimePanelVote'
      actorId: string
      vote: PanelVote['vote']
      reliefOption: string
      rationale: string
      joinsMajority: boolean
      separateWritingType?: PanelVote['separateWritingType']
      confidence: number
    }
  | {
      tool: 'draftRuntimePanelDisposition'
      actorId: string
      disposition: string
      text: string
      judgmentText: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'enterJudgment'
      actorId: string
      disposition: string
      judgmentText: string
      ruleRefs: RuleRef[]
    }
  | {
      tool: 'setMandateDeadline'
      actorId: string
      label: string
      offsetDays: number
      sourceRuleRefs: RuleRef[]
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

export type PanelAssignment = {
  id: string
  judgeActorIds: [string, string, string]
  presidingJudgeActorId: string
  assignedAt: string
  oralArgumentDisposition: 'submitted_on_briefs' | 'argument_scheduled' | 'argument_held'
}

export type BenchMemo = {
  id: string
  authorActorId: string
  issueSummaries: string[]
  recommendedDisposition: string
  reliefEvaluation: ReliefEvaluation
  risks: string[]
  createdAt: string
}

export type PanelVote = {
  id: string
  judgeActorId: string
  vote: 'affirm' | 'reverse' | 'vacate' | 'vacate_in_part' | 'dismiss' | 'remand'
  reliefOption: string
  rationale: string
  joinsMajority: boolean
  separateWritingType?: 'concurrence' | 'dissent' | 'concur_in_judgment'
  confidence: number
  createdAt: string
}

export type PanelDispositionRecord = {
  id: string
  disposition: string
  judgmentText: string
  majorityJudgeActorIds: string[]
  separateOpinions: Array<{
    judgeActorId: string
    type: 'concurrence' | 'dissent' | 'concur_in_judgment'
    text: string
  }>
  votes: PanelVote[]
  ruleRefs: RuleRef[]
  createdAt: string
}

export type PanelVotePosition =
  | 'affirm'
  | 'reverse'
  | 'vacate'
  | 'vacate_in_part'
  | 'dismiss'
  | 'remand'
  | 'procedural_order'

export type PanelDeliberation = {
  id: string
  caseSessionId: string
  posture: 'screening' | 'voting' | 'drafting' | 'entered'
  staffMemo?: string
  staffMemoRecord?: BenchMemo
  votes: PanelVote[]
  majorityPosition?: PanelVotePosition
  dispositionText?: string
  separateWritingText?: string
  judgmentText?: string
  mandateStatus: 'not_started' | 'pending' | 'issued' | 'stayed'
}

export type CounterpartyStrategy = {
  id: string
  caseSessionId: string
  preservedIssues: string[]
  forfeitureArguments: string[]
  jurisdictionArguments: string[]
  meritsArguments: string[]
  proceduralMotions: string[]
  recommendedNextFilingEventId?: string
  updatedAt?: string
}

export type AmicusCandidate = {
  id: string
  organizationName: string
  organizationType:
    | 'civil_rights_group'
    | 'trade_association'
    | 'government'
    | 'academic_center'
    | 'public_interest'
  supportsRole: 'appellant' | 'appellee' | 'neither'
  interestStatement: string
  requiresLeave: boolean
  consentStatus: 'all_parties_consent' | 'partial_consent' | 'no_consent' | 'unknown'
  recommended: boolean
  rationale: string
}

export type AmicusParticipation = {
  candidates: AmicusCandidate[]
  acceptedBriefIds: string[]
  deniedCandidateIds: string[]
}

export type EcfMetadataField = {
  key: string
  label: string
  inputType: 'text' | 'select' | 'checkbox' | 'date' | 'docket_entry_ref'
  required: boolean
  options?: string[]
}

export type EcfEventDefinition = {
  eventId: string
  category: EcfEventCategory
  displayName: string
  eligibleRoles: ParticipantRole[]
  requiresMainDocument: boolean
  requiredAttachments: string[]
  optionalAttachments: string[]
  metadataFields: EcfMetadataField[]
  menuPath: string[]
  courtEventCode: string
  requiresRelatedEntry: boolean
  requiresReliefText: boolean
  feeBehavior: EcfFeeBehavior
  serviceBehavior: EcfServiceBehavior
  partySelectionMode: EcfPartySelectionMode
  receiptTemplateId: string
}

export type EcfEventAvailability = EcfEventDefinition & {
  available: boolean
  unavailableReasons: string[]
}

export type ScenarioRecordExcerpt = {
  id: string
  label: string
  source: 'synthetic' | 'courtlistener' | 'uploaded'
  text: string
  citedByIssueIds: string[]
}

export type ScenarioIssue = {
  id: string
  label: string
  standardOfReview: string
  preservationFacts: string[]
  recordSupportFacts: string[]
  likelyArgumentsForAppellant: string[]
  likelyArgumentsForAppellee: string[]
  possibleRelief: string[]
}

export type ScenarioDifficulty = 'intro' | 'intermediate' | 'advanced'

export type ScenarioPracticeFocus =
  | 'jurisdiction'
  | 'case_opening'
  | 'motions'
  | 'briefing'
  | 'record_appendix'
  | 'amicus'
  | 'panel_merits'
  | 'post_judgment'
  | 'sealed_materials'

export type ScenarioTrainingMetadata = {
  difficulty: ScenarioDifficulty
  practiceFocus: ScenarioPracticeFocus[]
  learningObjectives: string[]
  modeledPitfalls: string[]
  expectedProceduralPath: string[]
  likelyAmici?: Array<{
    organizationName: string
    organizationType: string
    supportsRole: 'appellant' | 'appellee' | 'neither'
    triggerIssueIds: string[]
    interestStatement: string
    requiresLeave: boolean
  }>
}

export type PreservationEvaluation = {
  issueId: string
  status: IssueEvaluation['preservationStatus']
  reasons: string[]
  risk: IssueEvaluation['waiverOrForfeitureRisk']
}

export type RecordSupportEvaluation = {
  issueId: string
  support: IssueEvaluation['recordSupport']
  missingExcerpts: string[]
  reasons: string[]
}

export type DispositionOption = {
  position: PanelVotePosition
  relief: string
  available: boolean
  reasons: string[]
}
