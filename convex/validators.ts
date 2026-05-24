import { v } from 'convex/values'

export const participantRoleValidator = v.union(
  v.literal('appellant'),
  v.literal('appellee'),
  v.literal('amicus'),
  v.literal('clerk'),
  v.literal('panel'),
  v.literal('district_court'),
  v.literal('plaintiff'),
  v.literal('defendant'),
  v.literal('judge'),
  v.literal('agency'),
)

export const caseStatusValidator = v.union(
  v.literal('setup'),
  v.literal('active'),
  v.literal('submitted'),
  v.literal('closed'),
  v.literal('dismissed'),
)

export const filingOutcomeValidator = v.union(
  v.literal('accepted'),
  v.literal('accepted_with_deficiency'),
  v.literal('rejected'),
  v.literal('referred_to_panel'),
)

export const deadlineStatusValidator = v.union(
  v.literal('open'),
  v.literal('satisfied'),
  v.literal('missed'),
  v.literal('vacated'),
)

export const ruleRefValidator = v.object({
  ruleId: v.string(),
  label: v.string(),
  sourceUrl: v.string(),
})

export const validationIssueValidator = v.object({
  severity: v.union(v.literal('error'), v.literal('warning'), v.literal('info')),
  message: v.string(),
  ruleRefs: v.array(ruleRefValidator),
})

export const uploadedDocumentValidator = v.object({
  id: v.string(),
  fileName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  pageCount: v.optional(v.number()),
  extractedSignals: v.array(v.string()),
})

export const filingDraftValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  title: v.string(),
  documents: v.array(uploadedDocumentValidator),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
  sealed: v.boolean(),
  notes: v.string(),
})

export const filingRecordValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  title: v.string(),
  documents: v.array(uploadedDocumentValidator),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
  sealed: v.boolean(),
  notes: v.string(),
  id: v.string(),
  filedAt: v.string(),
  outcome: filingOutcomeValidator,
  validationIssues: v.array(validationIssueValidator),
})

export const scenarioValidator = v.object({
  id: v.string(),
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
})

export const participantValidator = v.object({
  id: v.string(),
  displayName: v.string(),
  role: participantRoleValidator,
})

export const docketEntryValidator = v.object({
  id: v.string(),
  entryNumber: v.number(),
  filedAt: v.string(),
  actorRole: participantRoleValidator,
  title: v.string(),
  text: v.string(),
  filingId: v.optional(v.string()),
  ruleRefs: v.array(ruleRefValidator),
})

export const deadlineValidator = v.object({
  id: v.string(),
  label: v.string(),
  dueDate: v.string(),
  targetEventId: v.string(),
  sourceEntryId: v.string(),
  status: deadlineStatusValidator,
  sourceRuleRefs: v.array(ruleRefValidator),
})

export const assessmentValidator = v.object({
  disposition: v.string(),
  score: v.number(),
  proceduralFindings: v.array(v.string()),
  meritsFindings: v.array(v.string()),
  nextPracticeTargets: v.array(v.string()),
})

export const caseSessionValidator = v.object({
  id: v.string(),
  scenario: scenarioValidator,
  courtPackId: v.string(),
  status: caseStatusValidator,
  simulatedDate: v.string(),
  participants: v.array(participantValidator),
  docketEntries: v.array(docketEntryValidator),
  deadlines: v.array(deadlineValidator),
  filings: v.array(filingRecordValidator),
  assessment: v.optional(assessmentValidator),
})

export const toolCallValidator = v.union(
  v.object({
    tool: v.literal('issueClerkOrder'),
    actorId: v.string(),
    title: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('fileCounterpartyDocument'),
    actorId: v.string(),
    eventId: v.string(),
    title: v.string(),
    text: v.string(),
  }),
  v.object({
    tool: v.literal('setDeadline'),
    actorId: v.string(),
    label: v.string(),
    targetEventId: v.string(),
    offsetDays: v.number(),
    sourceRuleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('submitToPanel'),
    actorId: v.string(),
    text: v.string(),
  }),
  v.object({
    tool: v.literal('issuePanelOrder'),
    actorId: v.string(),
    title: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('disposeCase'),
    actorId: v.string(),
    disposition: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
)

export const courtListenerSearchResultValidator = v.object({
  id: v.number(),
  absolute_url: v.optional(v.string()),
  caseName: v.optional(v.string()),
  caseNameFull: v.optional(v.string()),
  docket_id: v.optional(v.number()),
  docketNumber: v.optional(v.string()),
  court: v.optional(v.string()),
  court_id: v.optional(v.string()),
  dateFiled: v.optional(v.string()),
  more_docs: v.optional(v.boolean()),
  snippet: v.optional(v.string()),
})

export const trialDocketEntryValidator = v.object({
  entryNumber: v.number(),
  filedAt: v.string(),
  title: v.string(),
  text: v.string(),
})

export const trialDocketValidator = v.object({
  caption: v.string(),
  court: v.string(),
  docketNumber: v.string(),
  sourceUrl: v.optional(v.string()),
  entries: v.array(trialDocketEntryValidator),
})

export const caseSessionSummaryValidator = v.object({
  id: v.string(),
  scenarioTitle: v.string(),
  shortCaption: v.string(),
  status: caseStatusValidator,
  simulatedDate: v.string(),
  createdAt: v.number(),
})
