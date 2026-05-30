import { v } from 'convex/values'
import { participantRoleValidator, ruleRefValidator, validationIssueValidator } from './validators_core'

export const actorWorkProductKindValidator = v.union(
  v.literal('counterparty_strategy'),
  v.literal('counterparty_filing_draft'),
  v.literal('amicus_recommendation'),
  v.literal('amicus_filing_draft'),
  v.literal('bench_memo'),
  v.literal('judge_vote_memo'),
  v.literal('panel_disposition_draft'),
  v.literal('assessment_feedback'),
)

export const actorWorkProductStatusValidator = v.union(
  v.literal('proposed'),
  v.literal('auto_applied'),
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('needs_review'),
  v.literal('superseded'),
)

export const actorCitationValidator = v.object({
  id: v.string(),
  label: v.string(),
  sourceType: v.union(
    v.literal('filing'),
    v.literal('document_analysis'),
    v.literal('rule'),
    v.literal('record_excerpt'),
    v.literal('docket_entry'),
  ),
  sourceId: v.optional(v.string()),
  ruleRef: v.optional(ruleRefValidator),
  quote: v.optional(v.string()),
  pin: v.optional(v.string()),
})

export const generatedFilingDraftValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  title: v.string(),
  documentFileName: v.string(),
  documentText: v.string(),
  attachmentTexts: v.optional(
    v.array(
      v.object({
        label: v.string(),
        fileName: v.string(),
        text: v.string(),
        attachmentType: v.union(
          v.literal('main'),
          v.literal('appendix'),
          v.literal('exhibit'),
          v.literal('certificate'),
          v.literal('motion_attachment'),
          v.literal('other'),
        ),
      }),
    ),
  ),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
  sealed: v.boolean(),
  notes: v.string(),
  citations: v.array(actorCitationValidator),
  ruleRefs: v.array(ruleRefValidator),
  recordRefs: v.optional(v.array(v.string())),
  confidence: v.optional(v.number()),
  roleAuthority: v.optional(v.string()),
})

export const actorReasoningMemoValidator = v.object({
  title: v.string(),
  summary: v.string(),
  reasoning: v.array(v.string()),
  recommendations: v.array(v.string()),
  citations: v.array(actorCitationValidator),
  ruleRefs: v.array(ruleRefValidator),
  proceduralClaims: v.optional(v.array(v.string())),
  requestedDisposition: v.optional(v.string()),
  reliefOption: v.optional(v.string()),
  confidence: v.optional(v.number()),
  recordRefs: v.optional(v.array(v.string())),
  roleAuthority: v.optional(v.string()),
})

export const actorWorkProductValidator = v.object({
  id: v.string(),
  caseSessionId: v.string(),
  actorId: v.string(),
  kind: actorWorkProductKindValidator,
  status: actorWorkProductStatusValidator,
  reviewStatus: v.union(
    v.literal('proposed'),
    v.literal('auto_applied'),
    v.literal('accepted'),
    v.literal('rejected'),
    v.literal('needs_review'),
  ),
  workProduct: v.union(generatedFilingDraftValidator, actorReasoningMemoValidator),
  citations: v.array(actorCitationValidator),
  ruleRefs: v.array(ruleRefValidator),
  recordRefs: v.array(v.string()),
  confidence: v.number(),
  roleAuthority: v.string(),
  sourceDocumentAnalysisIds: v.array(v.string()),
  sourceFilingIds: v.array(v.string()),
  createdAt: v.string(),
  validationIssues: v.optional(v.array(validationIssueValidator)),
})
