/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

import {
  caseStatusValidator,
  actorWorkProductKindValidator,
  actorWorkProductStatusValidator,
  autonomyModeValidator,
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
  qualityStateValidator,
  ruleRefValidator,
  turnPolicyValidator,
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
    clerkOrganizationId: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('paused'), v.literal('archived')),
    monthlyAiBudgetCents: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_clerk_org', ['clerkOrganizationId']),

  institutionMemberships: defineTable({
    institutionId: v.id('institutions'),
    userId: v.id('users'),
    role: v.union(v.literal('learner'), v.literal('instructor'), v.literal('admin')),
    status: v.union(v.literal('active'), v.literal('suspended')),
    createdAt: v.string(),
    expiresAt: v.optional(v.string()),
  })
    .index('by_institution', ['institutionId'])
    .index('by_user', ['userId'])
    .index('by_institution_user', ['institutionId', 'userId']),

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

  enrollmentInvites: defineTable({
    institutionId: v.id('institutions'),
    cohortId: v.optional(v.id('cohorts')),
    email: v.string(),
    role: v.union(v.literal('learner'), v.literal('instructor'), v.literal('admin')),
    tokenHash: v.string(),
    expiresAt: v.string(),
    acceptedAt: v.optional(v.string()),
    createdByUserId: v.id('users'),
    createdAt: v.string(),
  })
    .index('by_token_hash', ['tokenHash'])
    .index('by_email', ['email'])
    .index('by_institution', ['institutionId'])
    .index('by_cohort', ['cohortId']),

  assignments: defineTable({
    cohortId: v.id('cohorts'),
    scenarioId: v.id('scenarios'),
    title: v.string(),
    dueAt: v.optional(v.string()),
    rubricId: v.optional(v.string()),
    published: v.boolean(),
    autonomyMode: v.optional(autonomyModeValidator),
    simulationPolicyId: v.optional(v.id('simulationPolicies')),
    budgetCapCents: v.optional(v.number()),
    hideAiReasoning: v.optional(v.boolean()),
    allowedFilingEvents: v.optional(v.array(v.string())),
    archivedAt: v.optional(v.string()),
    createdByUserId: v.id('users'),
    createdAt: v.string(),
    updatedAt: v.optional(v.string()),
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
    score: v.optional(v.number()),
    reopenedAt: v.optional(v.string()),
    reopenedByUserId: v.optional(v.id('users')),
  })
    .index('by_assignment', ['assignmentId'])
    .index('by_assignment_user', ['assignmentId', 'userId'])
    .index('by_user', ['userId'])
    .index('by_case', ['caseSessionId'])
    .index('by_assignment_case_user', ['assignmentId', 'caseSessionId', 'userId']),

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
    rawStorageId: v.optional(v.id('_storage')),
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
    provenance: v.optional(
      v.union(
        v.literal('source-backed'),
        v.literal('simulator-only'),
        v.literal('expert-authored'),
      ),
    ),
    topic: v.string(),
    kind: v.string(),
    value: v.string(),
    ruleRefs: v.array(ruleRefValidator),
    executableJson: v.optional(v.string()),
  })
    .index('by_constraint', ['constraintId'])
    .index('by_rule_module', ['ruleModuleId'])
    .index('by_rule', ['ruleId']),

  ecfCatalogEvents: defineTable({
    courtPackId: v.string(),
    eventId: v.string(),
    catalogJson: v.string(),
    sourceVersionIds: v.array(v.string()),
    published: v.boolean(),
  })
    .index('by_court_pack', ['courtPackId'])
    .index('by_event', ['courtPackId', 'eventId'])
    .index('by_published', ['published']),

  deadlineRules: defineTable({
    courtPackId: v.string(),
    deadlineId: v.string(),
    deadlineJson: v.string(),
    sourceVersionIds: v.array(v.string()),
    published: v.boolean(),
  })
    .index('by_court_pack', ['courtPackId'])
    .index('by_deadline', ['courtPackId', 'deadlineId'])
    .index('by_published', ['published']),

  sourceBackedConstraints: defineTable({
    courtPackId: v.string(),
    constraintId: v.string(),
    constraintJson: v.string(),
    sourceVersionIds: v.array(v.string()),
    published: v.boolean(),
  })
    .index('by_court_pack', ['courtPackId'])
    .index('by_constraint', ['courtPackId', 'constraintId'])
    .index('by_published', ['published']),

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
    releaseStatus: v.optional(
      v.union(
        v.literal('draft'),
        v.literal('source_review_pending'),
        v.literal('eval_pending'),
        v.literal('beta_approved'),
        v.literal('production_approved'),
        v.literal('retired'),
      ),
    ),
    sourceVersionIds: v.optional(v.array(v.string())),
    evalThresholdsJson: v.optional(v.string()),
    published: v.boolean(),
  }).index('by_pack_id', ['packId']),

  packBundles: defineTable({
    courtPackId: v.string(),
    bundleVersion: v.string(),
    label: v.string(),
    manifestJson: v.string(),
    zipStorageId: v.optional(v.id('_storage')),
    zipFileName: v.optional(v.string()),
    zipContentHash: v.optional(v.string()),
    zipSizeBytes: v.optional(v.number()),
    sourceVersionIds: v.array(v.string()),
    componentModuleIds: v.array(v.string()),
    artifactIds: v.array(v.id('sourceArtifacts')),
    status: v.union(
      v.literal('draft'),
      v.literal('indexed'),
      v.literal('published'),
      v.literal('retired'),
    ),
    createdByUserId: v.id('users'),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_court_pack', ['courtPackId'])
    .index('by_court_pack_version', ['courtPackId', 'bundleVersion'])
    .index('by_status', ['status']),

  scenarios: defineTable({
    scenarioKey: v.string(),
    visibility: v.optional(v.union(v.literal('public_template'), v.literal('private'))),
    scenarioFamilyKey: v.optional(v.string()),
    revision: v.optional(v.number()),
    revisionStatus: v.optional(
      v.union(v.literal('draft'), v.literal('published'), v.literal('archived')),
    ),
    createdFromScenarioId: v.optional(v.id('scenarios')),
    supersededByScenarioId: v.optional(v.id('scenarios')),
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
    trainingJson: v.optional(v.string()),
    trialDocketJson: v.optional(v.string()),
    documentAssetsJson: v.optional(v.string()),
    sourceCaseUrl: v.optional(v.string()),
    ownerUserId: v.optional(v.id('users')),
    published: v.boolean(),
  })
    .index('by_court_pack', ['courtPackId'])
    .index('by_scenario_key', ['scenarioKey'])
    .index('by_published', ['published'])
    .index('by_visibility', ['visibility'])
    .index('by_owner', ['ownerUserId'])
    .index('by_family_revision', ['scenarioFamilyKey', 'revision']),

  scenarioDocumentAssets: defineTable({
    scenarioId: v.id('scenarios'),
    assetKey: v.string(),
    label: v.string(),
    fileName: v.string(),
    mimeType: v.literal('application/pdf'),
    source: v.union(v.literal('synthetic'), v.literal('courtlistener'), v.literal('uploaded')),
    storageId: v.id('_storage'),
    sha256: v.optional(v.string()),
    sizeBytes: v.number(),
    pageCount: v.number(),
    extractedText: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_scenario', ['scenarioId'])
    .index('by_scenario_asset_key', ['scenarioId', 'assetKey'])
    .index('by_storage', ['storageId']),

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
    autonomyMode: v.optional(autonomyModeValidator),
    turnPolicy: v.optional(turnPolicyValidator),
    sourceProfileId: v.optional(v.string()),
    qualityState: v.optional(qualityStateValidator),
    legalTrainingDisclaimerAcceptedAt: v.optional(v.string()),
    simulatedDate: v.string(),
    nextEventSequence: v.optional(v.number()),
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
    sha256: v.optional(v.string()),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    pageCount: v.optional(v.number()),
    extractedText: v.optional(v.string()),
    textExtractionStatus: v.optional(
      v.union(
        v.literal('not_started'),
        v.literal('extracted'),
        v.literal('not_searchable'),
        v.literal('failed'),
        v.literal('fallback'),
      ),
    ),
    wordCount: v.optional(v.number()),
    analysisId: v.optional(v.id('documentAnalyses')),
    extractedSignals: v.array(v.string()),
    validationJson: v.optional(v.string()),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_storage', ['storageId']),

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
    analysisJson: v.optional(v.string()),
    extractedTextHash: v.optional(v.string()),
    wordCount: v.optional(v.number()),
    citationCount: v.optional(v.number()),
    recordCitationCount: v.optional(v.number()),
    appendixCitationCount: v.optional(v.number()),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_document', ['documentId']),

  actorWorkProducts: defineTable({
    caseSessionId: v.id('caseSessions'),
    actorId: v.string(),
    kind: actorWorkProductKindValidator,
    status: actorWorkProductStatusValidator,
    reviewStatus: v.optional(
      v.union(
        v.literal('proposed'),
        v.literal('auto_applied'),
        v.literal('accepted'),
        v.literal('rejected'),
        v.literal('needs_review'),
      ),
    ),
    workProductJson: v.string(),
    citationsJson: v.optional(v.string()),
    ruleRefs: v.optional(v.array(ruleRefValidator)),
    recordRefs: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    roleAuthority: v.optional(v.string()),
    sourceDocumentAnalysisIds: v.array(v.string()),
    sourceFilingIds: v.array(v.string()),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_case_kind', ['caseSessionId', 'kind'])
    .index('by_case_actor', ['caseSessionId', 'actorId']),

  filings: defineTable({
    caseSessionId: v.id('caseSessions'),
    eventId: v.string(),
    participantRole: participantRoleValidator,
    filerPartyId: v.optional(v.string()),
    partyIds: v.optional(v.array(v.string())),
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

  actorRunAudits: defineTable({
    caseSessionId: v.id('caseSessions'),
    actorId: v.string(),
    toolName: v.optional(v.string()),
    packetHash: v.string(),
    sourcePacketHash: v.string(),
    promptHash: v.string(),
    rawOutputStorageId: v.optional(v.id('_storage')),
    normalizedOutputJson: v.string(),
    validatorResultJson: v.string(),
    model: v.string(),
    providerId: v.string(),
    costCents: v.number(),
    latencyMs: v.number(),
    legalRiskLabels: v.array(
      v.union(
        v.literal('hallucinated_rule'),
        v.literal('unsupported_record_cite'),
        v.literal('unavailable_relief'),
        v.literal('missed_jurisdiction_issue'),
        v.literal('wrong_deadline'),
        v.literal('wrong_role_authority'),
        v.literal('premature_filing'),
        v.literal('improper_sealed_treatment'),
      ),
    ),
    appliedEffects: v.boolean(),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_actor', ['actorId']),

  simulationTurns: defineTable({
    caseSessionId: v.id('caseSessions'),
    turnNumber: v.number(),
    actorId: v.string(),
    kind: v.string(),
    status: v.string(),
    payloadJson: v.string(),
    inputSnapshotHash: v.optional(v.string()),
    outputSnapshotHash: v.optional(v.string()),
    validatorVersion: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    stoppedReason: v.optional(v.string()),
    rawActorPacketStorageId: v.optional(v.id('_storage')),
    rawProviderResultStorageId: v.optional(v.id('_storage')),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_case_turn', ['caseSessionId', 'turnNumber']),

  actorPackets: defineTable({
    caseSessionId: v.id('caseSessions'),
    turnId: v.id('simulationTurns'),
    actorId: v.string(),
    packetJson: v.string(),
    packetHash: v.optional(v.string()),
    rawStorageId: v.optional(v.id('_storage')),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_turn', ['turnId']),

  actorDecisions: defineTable({
    caseSessionId: v.id('caseSessions'),
    turnId: v.id('simulationTurns'),
    actorId: v.string(),
    decisionJson: v.string(),
    decisionHash: v.optional(v.string()),
    rawProviderResultStorageId: v.optional(v.id('_storage')),
    accepted: v.boolean(),
    issues: v.array(v.string()),
    createdAt: v.string(),
  })
    .index('by_case', ['caseSessionId'])
    .index('by_turn', ['turnId']),

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

  sourceArtifacts: defineTable({
    sourceVersionId: v.string(),
    label: v.string(),
    url: v.string(),
    fetchedAt: v.string(),
    contentHash: v.string(),
    parserVersion: v.string(),
    effectiveDate: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    rawStorageId: v.optional(v.id('_storage')),
    rawText: v.optional(v.string()),
    reviewStatus: v.union(
      v.literal('draft'),
      v.literal('reviewed'),
      v.literal('published'),
      v.literal('rejected'),
    ),
  })
    .index('by_source_version', ['sourceVersionId'])
    .index('by_status', ['reviewStatus'])
    .index('by_hash', ['contentHash']),

  sourceReviewDecisions: defineTable({
    sourceArtifactId: v.id('sourceArtifacts'),
    reviewerUserId: v.id('users'),
    decision: v.union(v.literal('reviewed'), v.literal('published'), v.literal('rejected')),
    notes: v.string(),
    changedConstraintsJson: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_source_artifact', ['sourceArtifactId'])
    .index('by_reviewer', ['reviewerUserId']),

  simulationPolicies: defineTable({
    scope: v.union(v.literal('course'), v.literal('assignment'), v.literal('session')),
    scopeId: v.string(),
    autonomyMode: autonomyModeValidator,
    maxTurnsPerRun: v.number(),
    maxCostCentsPerRun: v.number(),
    requireHumanApprovalFor: v.array(v.string()),
    stopOnDeficiency: v.boolean(),
    createdByUserId: v.id('users'),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_scope', ['scope', 'scopeId'])
    .index('by_creator', ['createdByUserId']),

  simulationEvalRuns: defineTable({
    scenarioId: v.id('scenarios'),
    model: v.string(),
    pass: v.boolean(),
    legalRiskLabels: v.array(v.string()),
    regressionMetadataJson: v.string(),
    criticalFailureCount: v.number(),
    validTurnRate: v.number(),
    hallucinatedSourceRate: v.optional(v.number()),
    roleAuthorityFailureRate: v.optional(v.number()),
    createdAt: v.string(),
  })
    .index('by_scenario', ['scenarioId'])
    .index('by_model', ['model'])
    .index('by_pass', ['pass']),

  policyVersions: defineTable({
    policyKey: v.union(
      v.literal('terms'),
      v.literal('privacy'),
      v.literal('training_disclaimer'),
      v.literal('ai_disclosure'),
      v.literal('ferpa'),
      v.literal('data_retention'),
      v.literal('support_access'),
    ),
    version: v.string(),
    title: v.string(),
    bodyMarkdown: v.string(),
    effectiveAt: v.string(),
    published: v.boolean(),
  })
    .index('by_policy_key', ['policyKey'])
    .index('by_policy_version', ['policyKey', 'version'])
    .index('by_published', ['published']),

  policyAcceptances: defineTable({
    userId: v.id('users'),
    policyKey: v.union(
      v.literal('terms'),
      v.literal('privacy'),
      v.literal('training_disclaimer'),
      v.literal('ai_disclosure'),
      v.literal('ferpa'),
      v.literal('data_retention'),
      v.literal('support_access'),
    ),
    version: v.string(),
    acceptedAt: v.string(),
    contextJson: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    .index('by_user_policy', ['userId', 'policyKey'])
    .index('by_user_policy_version', ['userId', 'policyKey', 'version']),

  supportAccessGrants: defineTable({
    institutionId: v.id('institutions'),
    supportUserId: v.id('users'),
    grantedByUserId: v.id('users'),
    reason: v.string(),
    expiresAt: v.string(),
    revokedAt: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_institution', ['institutionId'])
    .index('by_support_user', ['supportUserId']),

  auditLog: defineTable({
    actorUserId: v.optional(v.id('users')),
    institutionId: v.optional(v.id('institutions')),
    cohortId: v.optional(v.id('cohorts')),
    caseSessionId: v.optional(v.id('caseSessions')),
    action: v.string(),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index('by_actor', ['actorUserId'])
    .index('by_institution', ['institutionId'])
    .index('by_case', ['caseSessionId'])
    .index('by_action', ['action']),

  userDisclaimers: defineTable({
    userId: v.id('users'),
    version: v.string(),
    acceptedAt: v.string(),
    trainingOnly: v.boolean(),
  })
    .index('by_user', ['userId'])
    .index('by_user_version', ['userId', 'version']),
})
