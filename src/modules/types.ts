import type {
  AiActorRole,
  AiToolName,
  Assessment,
  CaseSession,
  CourtLevel,
  CourtSystem,
  DocumentRequirement,
  FilingEvent,
  ParticipantRole,
  ProcedureDomain,
  RuleItem,
  RuleRef,
  Scenario,
  StructuredConstraint,
  UploadedDocument,
} from '../domain/types'

export type LegalSourceVersion = {
  id: string
  label: string
  jurisdiction: string
  version: string
  effectiveFrom: string
  effectiveTo?: string
  sourceUrl: string
  sourceSystem: 'court' | 'uscourts' | 'courtlistener' | 'recap' | 'manual'
  reviewed: boolean
}

export type RuleConstraint = {
  id: string
  ruleId: string
  sourceVersionId: string
  topic: string
  kind: StructuredConstraint['kind']
  value: string
  ruleRefs: RuleRef[]
}

export type RuleModule = {
  id: string
  jurisdiction: string
  version: string
  effectiveFrom: string
  sources: LegalSourceVersion[]
  constraints: RuleConstraint[]
  ruleItems: RuleItem[]
}

export type FilingFieldDefinition = {
  id: string
  label: string
  type: 'text' | 'textarea' | 'boolean' | 'date' | 'select' | 'file'
  required: boolean
  options?: string[]
}

export type FilingEventModule = {
  id: string
  label: string
  category: string
  allowedRoles: ParticipantRole[]
  requiredDocuments: DocumentRequirement[]
  optionalDocuments: DocumentRequirement[]
  requiredFields: FilingFieldDefinition[]
  constraints: string[]
  receiptTemplateId: string
  docketTemplateId: string
  event: FilingEvent
}

export type CourtModule = {
  id: string
  label: string
  courtSystem: CourtSystem
  courtLevel: CourtLevel
  procedureDomains: ProcedureDomain[]
  docketNumberFormat: string
  rulePackIds: string[]
  filingEventIds: string[]
  actorProfileIds: string[]
  stateMachineIds: string[]
}

export type AvailableFilingEvent = {
  eventId: string
  label: string
  available: boolean
  reasons: string[]
}

export type ProcedureTransition = {
  id: string
  fromState: string
  toState: string
  filingEventId?: string
  actorToolName?: AiToolName
  guard: string
  effect: string
  ruleRefs: RuleRef[]
}

export type ProcedureModule = {
  id: string
  domain: ProcedureDomain
  initialState: string
  transitions: ProcedureTransition[]
  availableEvents(session: CaseSession): AvailableFilingEvent[]
}

export type UploadedFile = Pick<
  UploadedDocument,
  'fileName' | 'mimeType' | 'sizeBytes' | 'pageCount' | 'extractedSignals'
>

export type DocumentAnalysis = {
  analyzerId: string
  pageCount?: number
  fileSizeBytes: number
  mimeType: string
  searchableText: boolean
  certificateOfServiceDetected: boolean
  certificateOfComplianceDetected: boolean
  sealedOrRedactionWarning: boolean
  warnings: string[]
}

export type DocumentAnalyzer = {
  id: string
  analyze(file: UploadedFile): Promise<DocumentAnalysis>
}

export type ActorModule = {
  id: string
  role: AiActorRole
  label: string
  authorityScope: string[]
  allowedTools: AiToolName[]
  promptProfileId: string
  strategyPolicyId?: string
}

export type StructuredAiRequest<T> = {
  schemaName: string
  schema: unknown
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  metadata?: Record<string, unknown>
  validate?(value: unknown): value is T
}

export type StructuredAiResult<T> = {
  value: T | null
  rawText: string
  providerId: string
}

export type AiProvider = {
  id: string
  completeStructured<T>(
    request: StructuredAiRequest<T>,
  ): Promise<StructuredAiResult<T>>
}

export type SourceSearchResult = {
  id: string
  title: string
  sourceUrl?: string
  metadata: Record<string, unknown>
}

export type SourceCaseDraft = {
  title: string
  source: Scenario['source']
  courtPackId: string
  shortCaption: string
  lowerTribunal: string
  natureOfSuit: string
  proceduralPosture: string
  issuesPresented: string[]
  meritsRecord: string[]
  sourceCaseUrl?: string
  provenance: Record<string, unknown>
}

export type SourceImporter = {
  id: string
  sourceSystem: 'courtlistener' | 'recap' | 'manual'
  search(query: string): Promise<SourceSearchResult[]>
  import(result: SourceSearchResult): Promise<SourceCaseDraft>
}

export type IssueModelDefinition = {
  id: string
  label: string
  standardOfReview: string
  preservationSignals: string[]
  recordSupportSignals: string[]
}

export type ReliefRule = {
  id: string
  label: string
  availableWhen: string[]
  unavailableWhen: string[]
}

export type MeritsEvaluation = {
  moduleId: string
  issueFindings: string[]
  availableRelief: string[]
  barredRelief: string[]
}

export type MeritsModule = {
  id: string
  issueModels: IssueModelDefinition[]
  reliefRules: ReliefRule[]
  evaluate(session: CaseSession): MeritsEvaluation
}

export type AssessmentRubric = {
  id: string
  criteria: Array<{ id: string; label: string; maxScore: number }>
}

export type AssessmentModule = {
  id: string
  rubric: AssessmentRubric
  assess(session: CaseSession): Assessment
}
