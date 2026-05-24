import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

import {
  caseStatusValidator,
  amicusCandidateValidator,
  amicusParticipationValidator,
  benchMemoValidator,
  counterpartyStrategyValidator,
  deadlineStatusValidator,
  panelAssignmentValidator,
  panelDeliberationValidator,
  panelDispositionRecordValidator,
  panelVoteValidator,
  filingOutcomeValidator,
  participantRoleValidator,
  procedureStateValidator,
  ruleRefValidator,
  validationIssueValidator,
} from './validators'

export default defineSchema({
  users: defineTable({
    authSubject: v.string(),
    displayName: v.string(),
    role: v.union(v.literal('student'), v.literal('admin'), v.literal('instructor')),
    monthlyAiBudgetCents: v.number(),
  }).index('by_auth_subject', ['authSubject']),

  institutions: defineTable({
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal('active'), v.literal('paused'), v.literal('archived')),
    monthlyAiBudgetCents: v.number(),
  }).index('by_slug', ['slug']),

  cohorts: defineTable({
    institutionId: v.id('institutions'),
    title: v.string(),
    term: v.string(),
    startsAt: v.string(),
    endsAt: v.string(),
    archived: v.boolean(),
  })
    .index('by_institution', ['institutionId'])
    .index('by_archived', ['archived']),

  cohortMemberships: defineTable({
    cohortId: v.id('cohorts'),
    userId: v.id('users'),
    role: v.union(v.literal('learner'), v.literal('instructor'), v.literal('admin')),
  })
    .index('by_cohort', ['cohortId'])
    .index('by_user', ['userId'])
    .index('by_cohort_user', ['cohortId', 'userId']),

  assignments: defineTable({
    cohortId: v.id('cohorts'),
    scenarioId: v.id('scenarios'),
    title: v.string(),
    dueAt: v.optional(v.string()),
    rubricId: v.optional(v.string()),
    published: v.boolean(),
    createdByUserId: v.id('users'),
    createdAt: v.string(),
  })
    .index('by_cohort', ['cohortId'])
    .index('by_published', ['published']),

  assignmentSessions: defineTable({
    assignmentId: v.id('assignments'),
    caseSessionId: v.id('caseSessions'),
    userId: v.id('users'),
    submittedAt: v.optional(v.string()),
    reviewedAt: v.optional(v.string()),
    reviewerUserId: v.optional(v.id('users')),
    instructorNote: v.optional(v.string()),
  })
    .index('by_assignment', ['assignmentId'])
    .index('by_user', ['userId'])
    .index('by_case', ['caseSessionId']),

  rulePacks: defineTable({
    packId: v.string(),
    moduleId: v.optional(v.string()),
    label: v.string(),
    courtSystem: v.string(),
    courtLevel: v.optional(v.string()),
    procedureDomain: v.optional(v.string()),
    version: v.string(),
    sourceUrl: v.string(),
    sourceVersionIds: v.optional(v.array(v.string())),
    published: v.boolean(),
  }).index('by_pack_version', ['packId', 'version']),

  legalSourceVersions: defineTable({
    sourceVersionId: v.string(),
    moduleId: v.string(),
    label: v.string(),
    jurisdiction: v.string(),
    version: v.string(),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    sourceUrl: v.string(),
    sourceSystem: v.union(
      v.literal('court'),
      v.literal('uscourts'),
      v.literal('courtlistener'),
      v.literal('recap'),
      v.literal('manual'),
    ),
    reviewed: v.boolean(),
    metadataJson: v.optional(v.string()),
  })
    .index('by_source_version', ['sourceVersionId'])
    .index('by_module', ['moduleId']),

  legalSourceSnapshots: defineTable({
    sourceVersionId: v.string(),
    fetchedAt: v.string(),
    contentHash: v.string(),
    rawText: v.string(),
    parserVersion: v.string(),
    reviewStatus: v.union(
      v.literal('draft'),
      v.literal('reviewed'),
      v.literal('published'),
      v.literal('rejected'),
    ),
  })
    .index('by_source_version', ['sourceVersionId'])
    .index('by_status', ['reviewStatus']),

  ruleReviewNotes: defineTable({
    sourceVersionId: v.string(),
    reviewerUserId: v.id('users'),
    note: v.string(),
    createdAt: v.string(),
  }).index('by_source_version', ['sourceVersionId']),

  ruleConstraints: defineTable({
    constraintId: v.string(),
    ruleModuleId: v.string(),
    ruleId: v.string(),
    sourceVersionId: v.string(),
    topic: v.string(),
    kind: v.string(),
    value: v.string(),
    ruleRefs: v.array(ruleRefValidator),
    executableJson: v.optional(v.string()),
  })
    .index('by_constraint', ['constraintId'])
    .index('by_rule_module', ['ruleModuleId'])
    .index('by_rule', ['ruleId']),

  moduleManifests: defineTable({
    moduleId: v.string(),
    type: v.string(),
    label: v.string(),
    version: v.string(),
    dependenciesJson: v.optional(v.string()),
    enabled: v.boolean(),
    published: v.boolean(),
  })
    .index('by_module_id', ['moduleId'])
    .index('by_type', ['type']),

  ruleItems: defineTable({
    packId: v.string(),
    jurisdiction: v.optional(v.string()),
    ruleId: v.string(),
    topic: v.string(),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    sourceLabel: v.string(),
    sourceUrl: v.string(),
    plainText: v.string(),
    simulatorNotes: v.string(),
    constraintsJson: v.string(),
  }).index('by_pack', ['packId']),

  courtPacks: defineTable({
    packId: v.string(),
    moduleId: v.optional(v.string()),
    label: v.string(),
    courtSystem: v.string(),
    courtLevel: v.string(),
    procedureDomain: v.string(),
    baseCourtPackIds: v.array(v.string()),
    includedRulePackIds: v.array(v.string()),
    rulePackIds: v.array(v.string()),
    procedureModuleIds: v.optional(v.array(v.string())),
    participantRoles: v.optional(v.array(participantRoleValidator)),
    filingEventsJson: v.optional(v.string()),
    aiActorsJson: v.optional(v.string()),
    docketNumberFormat: v.string(),
    published: v.boolean(),
  }).index('by_pack_id', ['packId']),

  scenarios: defineTable({
    scenarioKey: v.string(),
    title: v.string(),
    source: v.union(
      v.literal('synthetic'),
      v.literal('recap_import'),
      v.literal('generated_from_import'),
    ),
    courtPackId: v.string(),
    shortCaption: v.string(),
    lowerTribunal: v.string(),
    natureOfSuit: v.string(),
    proceduralPosture: v.string(),
    issuesPresented: v.array(v.string()),
    meritsRecord: v.array(v.string()),
    sourceCaseUrl: v.optional(v.string()),
    ownerUserId: v.optional(v.id('users')),
    published: v.boolean(),
  })
    .index('by_court_pack', ['courtPackId'])
    .index('by_scenario_key', ['scenarioKey'])
    .index('by_published', ['published']),

  scenarioIssues: defineTable({
    scenarioId: v.id('scenarios'),
    issueId: v.string(),
    label: v.string(),
    standardOfReview: v.string(),
    preservationFacts: v.array(v.string()),
    recordSupportFacts: v.array(v.string()),
    likelyArgumentsForAppellant: v.array(v.string()),
    likelyArgumentsForAppellee: v.array(v.string()),
    possibleRelief: v.array(v.string()),
  })
    .index('by_scenario', ['scenarioId'])
    .index('by_scenario_issue', ['scenarioId', 'issueId']),

  scenarioRecordExcerpts: defineTable({
    scenarioId: v.id('scenarios'),
    excerptId: v.string(),
    label: v.string(),
    source: v.union(v.literal('synthetic'), v.literal('courtlistener'), v.literal('uploaded')),
    text: v.string(),
    citedByIssueIds: v.array(v.string()),
  }).index('by_scenario', ['scenarioId']),

  sourceCases: defineTable({
    scenarioId: v.id('scenarios'),
    sourceSystem: v.union(v.literal('courtlistener'), v.literal('recap'), v.literal('manual')),
    externalId: v.string(),
    sourceUrl: v.string(),
    importedAt: v.string(),
    provenanceJson: v.string(),
  }).index('by_scenario', ['scenarioId']),

  caseSessions: defineTable({
    scenarioId: v.id('scenarios'),
    userId: v.id('users'),
    courtPackId: v.string(),
    status: caseStatusValidator,
    procedureState: v.optional(procedureStateValidator),
    simulatedDate: v.string(),
  })
    .index('by_user', ['userId'])
    .index('by_scenario', ['scenarioId']),

  participants: defineTable({
    caseSessionId: v.id('caseSessions'),
    displayName: v.string(),
    role: participantRoleValidator,
  }).index('by_case', ['caseSessionId']),

  documents: defineTable({
    caseSessionId: v.id('caseSessions'),
    storageId: v.optional(v.id('_storage')),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    pageCount: v.optional(v.number()),
    extractedText: v.optional(v.string()),
    extractedSignals: v.array(v.string()),
    validationJson: v.optional(v.string()),
  }).index('by_case', ['caseSessionId']),

  caseSessionEvents: defineTable({
    caseSessionId: v.id('caseSessions'),
    sequence: v.number(),
    eventType: v.string(),
    payloadJson: v.string(),
    createdAt: v.string(),
    actorUserId: v.optional(v.id('users')),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_case_sequence', ['caseSessionId', 'sequence']),

  ecfReceipts: defineTable({
    caseSessionId: v.id('caseSessions'),
    filingId: v.id('filings'),
    receiptNumber: v.string(),
    filedTimestamp: v.optional(v.string()),
    filer: v.optional(participantRoleValidator),
    eventId: v.optional(v.string()),
    documentListJson: v.optional(v.string()),
    noticeOfDocketActivityText: v.string(),
    serviceListJson: v.string(),
    docketText: v.optional(v.string()),
    warnings: v.optional(v.array(v.string())),
    deficiencies: v.optional(v.array(v.string())),
    nextExpectedDeadlineJson: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_filing', ['filingId'])
    .index('by_receipt', ['receiptNumber']),

  documentAnalyses: defineTable({
    caseSessionId: v.id('caseSessions'),
    documentId: v.optional(v.id('documents')),
    analyzerId: v.string(),
    pageCount: v.optional(v.number()),
    fileSizeBytes: v.number(),
    mimeType: v.string(),
    searchableText: v.boolean(),
    certificateOfServiceDetected: v.boolean(),
    certificateOfComplianceDetected: v.boolean(),
    sealedOrRedactionWarning: v.boolean(),
    warnings: v.array(v.string()),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_document', ['documentId']),

  filings: defineTable({
    caseSessionId: v.id('caseSessions'),
    eventId: v.string(),
    participantRole: participantRoleValidator,
    title: v.string(),
    documentIds: v.array(v.id('documents')),
    certificateOfService: v.boolean(),
    certificateOfCompliance: v.boolean(),
    sealed: v.boolean(),
    notes: v.string(),
    submissionJson: v.optional(v.string()),
    documentAnalysisIds: v.optional(v.array(v.id('documentAnalyses'))),
    filedAt: v.string(),
    outcome: filingOutcomeValidator,
    validationIssues: v.array(validationIssueValidator),
  }).index('by_case', ['caseSessionId']),

  procedureTransitions: defineTable({
    transitionId: v.string(),
    procedureModuleId: v.string(),
    fromState: v.string(),
    toState: v.string(),
    filingEventId: v.optional(v.string()),
    actorToolName: v.optional(v.string()),
    guard: v.string(),
    effect: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  })
    .index('by_transition', ['transitionId'])
    .index('by_procedure_module', ['procedureModuleId']),

  docketEntries: defineTable({
    caseSessionId: v.id('caseSessions'),
    entryNumber: v.number(),
    filedAt: v.string(),
    actorRole: participantRoleValidator,
    title: v.string(),
    text: v.string(),
    filingId: v.optional(v.id('filings')),
    ruleRefs: v.array(ruleRefValidator),
  }).index('by_case', ['caseSessionId']),

  deadlines: defineTable({
    caseSessionId: v.id('caseSessions'),
    label: v.string(),
    dueDate: v.string(),
    targetEventId: v.string(),
    sourceEntryId: v.optional(v.id('docketEntries')),
    status: deadlineStatusValidator,
    sourceRuleRefs: v.array(ruleRefValidator),
  }).index('by_case', ['caseSessionId']),

  aiRuns: defineTable({
    caseSessionId: v.id('caseSessions'),
    userId: v.id('users'),
    actorId: v.string(),
    model: v.string(),
    provider: v.string(),
    providerId: v.optional(v.string()),
    actorModuleId: v.optional(v.string()),
    toolName: v.optional(v.string()),
    stateTransitionId: v.optional(v.string()),
    promptHash: v.string(),
    toolCallJson: v.string(),
    accepted: v.boolean(),
    issues: v.array(v.string()),
    costCents: v.number(),
    latencyMs: v.number(),
    errorClass: v.optional(v.string()),
    createdMonth: v.string(),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_user_month', ['userId', 'createdMonth']),

  integrationEvents: defineTable({
    userId: v.id('users'),
    caseSessionId: v.optional(v.id('caseSessions')),
    provider: v.union(v.literal('openrouter'), v.literal('courtlistener')),
    action: v.string(),
    accepted: v.boolean(),
    errorClass: v.optional(v.string()),
    createdAt: v.string(),
  }).index('by_user_provider', ['userId', 'provider']),

  trialDocketImports: defineTable({
    caseSessionId: v.id('caseSessions'),
    caption: v.string(),
    court: v.string(),
    docketNumber: v.string(),
    sourceUrl: v.optional(v.string()),
    entriesJson: v.string(),
    importedAt: v.string(),
  }).index('by_case', ['caseSessionId']),

  counterpartyStrategies: defineTable({
    caseSessionId: v.id('caseSessions'),
    strategy: counterpartyStrategyValidator,
    createdAt: v.string(),
  }).index('by_case', ['caseSessionId']),

  amicusCandidates: defineTable({
    caseSessionId: v.id('caseSessions'),
    candidate: amicusCandidateValidator,
    createdAt: v.string(),
  }).index('by_case', ['caseSessionId']),

  amicusParticipations: defineTable({
    caseSessionId: v.id('caseSessions'),
    participation: amicusParticipationValidator,
    createdAt: v.string(),
  }).index('by_case', ['caseSessionId']),

  panelDeliberations: defineTable({
    caseSessionId: v.id('caseSessions'),
    assignment: v.optional(panelAssignmentValidator),
    benchMemo: v.optional(benchMemoValidator),
    deliberation: v.optional(panelDeliberationValidator),
    createdAt: v.string(),
  }).index('by_case', ['caseSessionId']),

  panelDispositions: defineTable({
    caseSessionId: v.id('caseSessions'),
    disposition: panelDispositionRecordValidator,
    createdAt: v.string(),
  }).index('by_case', ['caseSessionId']),

  panelVotes: defineTable({
    caseSessionId: v.id('caseSessions'),
    actorModuleId: v.string(),
    vote: v.string(),
    reliefOption: v.string(),
    rationale: v.string(),
    voteRecord: v.optional(panelVoteValidator),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_actor_module', ['actorModuleId']),

  meritsEvaluations: defineTable({
    caseSessionId: v.id('caseSessions'),
    meritsModuleId: v.string(),
    issueFindings: v.array(v.string()),
    availableRelief: v.array(v.string()),
    barredRelief: v.array(v.string()),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_module', ['meritsModuleId']),

  scenarioDrafts: defineTable({
    sourceSystem: v.union(v.literal('courtlistener'), v.literal('recap'), v.literal('manual')),
    importerId: v.string(),
    title: v.string(),
    courtPackId: v.string(),
    draftJson: v.string(),
    provenanceJson: v.string(),
    reviewStatus: v.union(
      v.literal('draft'),
      v.literal('reviewed'),
      v.literal('published'),
      v.literal('rejected'),
    ),
    reviewedByUserId: v.optional(v.id('users')),
    createdAt: v.string(),
    reviewedAt: v.optional(v.string()),
  })
    .index('by_status', ['reviewStatus'])
    .index('by_source', ['sourceSystem']),

  sourceDocuments: defineTable({
    sourceSystem: v.union(v.literal('courtlistener'), v.literal('recap'), v.literal('manual')),
    externalId: v.string(),
    sourceUrl: v.optional(v.string()),
    title: v.string(),
    metadataJson: v.string(),
    importedAt: v.string(),
  })
    .index('by_external', ['sourceSystem', 'externalId']),

  assessments: defineTable({
    caseSessionId: v.id('caseSessions'),
    rubricId: v.optional(v.string()),
    disposition: v.string(),
    score: v.number(),
    scoreBreakdownJson: v.optional(v.string()),
    proceduralFindings: v.array(v.string()),
    meritsFindings: v.array(v.string()),
    nextPracticeTargets: v.array(v.string()),
  }).index('by_case', ['caseSessionId']),
})
