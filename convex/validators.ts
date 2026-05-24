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

export const procedureStateValidator = v.union(
  v.literal('case_opened'),
  v.literal('notice_pending'),
  v.literal('jurisdiction_review'),
  v.literal('appearance_pending'),
  v.literal('fee_or_ifp_pending'),
  v.literal('record_pending'),
  v.literal('briefing_schedule_pending'),
  v.literal('opening_brief_pending'),
  v.literal('appendix_pending'),
  v.literal('appellee_brief_pending'),
  v.literal('reply_brief_pending'),
  v.literal('motion_pending'),
  v.literal('submitted'),
  v.literal('panel_deliberation'),
  v.literal('judgment_entered'),
  v.literal('rehearing_pending'),
  v.literal('mandate_pending'),
  v.literal('closed'),
  v.literal('dismissed'),
)

export const filingOutcomeValidator = v.union(
  v.literal('accepted'),
  v.literal('accepted_with_deficiency'),
  v.literal('rejected'),
  v.literal('referred_to_panel'),
  v.literal('lodged_pending_review'),
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
  code: v.optional(v.string()),
  cureSuggestion: v.optional(v.string()),
})

export const uploadedDocumentValidator = v.object({
  id: v.string(),
  fileName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  pageCount: v.optional(v.number()),
  extractedText: v.optional(v.string()),
  extractedSignals: v.array(v.string()),
})

export const filingAttachmentValidator = v.object({
  id: v.string(),
  label: v.string(),
  document: uploadedDocumentValidator,
  attachmentType: v.union(
    v.literal('main'),
    v.literal('appendix'),
    v.literal('exhibit'),
    v.literal('certificate'),
    v.literal('motion_attachment'),
    v.literal('other'),
  ),
})

export const filingMetadataValidator = v.object({
  representedPartyId: v.optional(v.string()),
  reliefRequested: v.optional(v.string()),
  serviceMethod: v.union(
    v.literal('cm_ecf'),
    v.literal('mail'),
    v.literal('email'),
    v.literal('hand_delivery'),
    v.literal('none'),
  ),
  relatedDocketEntryId: v.optional(v.string()),
  emergency: v.boolean(),
  sealed: v.boolean(),
  redactionAcknowledged: v.boolean(),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
})

export const filingSubmissionValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  title: v.string(),
  mainDocument: uploadedDocumentValidator,
  attachments: v.array(filingAttachmentValidator),
  metadata: filingMetadataValidator,
  notes: v.string(),
})

export const preflightCheckResultValidator = v.object({
  accepted: v.boolean(),
  outcome: filingOutcomeValidator,
  issues: v.array(validationIssueValidator),
  analyzedAt: v.string(),
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
  procedureState: v.optional(procedureStateValidator),
  simulatedDate: v.string(),
  participants: v.array(participantValidator),
  docketEntries: v.array(docketEntryValidator),
  deadlines: v.array(deadlineValidator),
  filings: v.array(filingRecordValidator),
  assessment: v.optional(assessmentValidator),
})

export const ecfReceiptValidator = v.object({
  id: v.string(),
  caseSessionId: v.string(),
  filingId: v.string(),
  receiptNumber: v.string(),
  noticeOfDocketActivityText: v.string(),
  serviceList: v.array(v.string()),
  createdAt: v.string(),
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
  v.object({
    tool: v.literal('recommendClerkAction'),
    actorId: v.string(),
    recommendation: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('draftClerkOrder'),
    actorId: v.string(),
    title: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('draftCounterpartyFiling'),
    actorId: v.string(),
    eventId: v.string(),
    title: v.string(),
    text: v.string(),
  }),
  v.object({
    tool: v.literal('recommendAmicusParticipation'),
    actorId: v.string(),
    organizationType: v.string(),
    rationale: v.string(),
    requiresLeave: v.boolean(),
  }),
  v.object({
    tool: v.literal('draftBenchMemo'),
    actorId: v.string(),
    issueSummary: v.string(),
    recommendation: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('castPanelVote'),
    actorId: v.string(),
    vote: v.string(),
    reliefOption: v.string(),
    rationale: v.string(),
    confidence: v.number(),
  }),
  v.object({
    tool: v.literal('draftPanelDisposition'),
    actorId: v.string(),
    disposition: v.string(),
    text: v.string(),
    reliefOption: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('draftAssessmentFeedback'),
    actorId: v.string(),
    proceduralFindings: v.array(v.string()),
    meritsFindings: v.array(v.string()),
    nextPracticeTargets: v.array(v.string()),
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
