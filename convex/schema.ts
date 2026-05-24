import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

import {
  caseStatusValidator,
  deadlineStatusValidator,
  filingOutcomeValidator,
  participantRoleValidator,
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

  rulePacks: defineTable({
    packId: v.string(),
    label: v.string(),
    courtSystem: v.string(),
    courtLevel: v.optional(v.string()),
    procedureDomain: v.optional(v.string()),
    version: v.string(),
    sourceUrl: v.string(),
    published: v.boolean(),
  }).index('by_pack_version', ['packId', 'version']),

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
    label: v.string(),
    courtSystem: v.string(),
    courtLevel: v.string(),
    procedureDomain: v.string(),
    baseCourtPackIds: v.array(v.string()),
    includedRulePackIds: v.array(v.string()),
    rulePackIds: v.array(v.string()),
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
    filedAt: v.string(),
    outcome: filingOutcomeValidator,
    validationIssues: v.array(validationIssueValidator),
  }).index('by_case', ['caseSessionId']),

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

  assessments: defineTable({
    caseSessionId: v.id('caseSessions'),
    disposition: v.string(),
    score: v.number(),
    proceduralFindings: v.array(v.string()),
    meritsFindings: v.array(v.string()),
    nextPracticeTargets: v.array(v.string()),
  }).index('by_case', ['caseSessionId']),
})
