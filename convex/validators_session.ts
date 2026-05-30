import { v } from 'convex/values'
import {
  participantRoleValidator,
  caseStatusValidator,
  procedureStateValidator,
  autonomyModeValidator,
  turnPolicyValidator,
  qualityStateValidator,
  deadlineStatusValidator,
  ruleRefValidator,
} from './validators_core'
import { scenarioValidator, participantValidator } from './validators_scenario'
import { filingRecordValidator } from './validators_filing'
import { actorWorkProductValidator } from './validators_actor'

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

export const reliefEvaluationValidator = v.object({
  availableRelief: v.array(v.string()),
  barredRelief: v.array(v.string()),
  reasons: v.array(v.string()),
})

export const panelAssignmentValidator = v.object({
  id: v.string(),
  judgeActorIds: v.array(v.string()),
  presidingJudgeActorId: v.string(),
  assignedAt: v.string(),
  oralArgumentDisposition: v.union(
    v.literal('submitted_on_briefs'),
    v.literal('argument_scheduled'),
    v.literal('argument_held'),
  ),
})

export const benchMemoValidator = v.object({
  id: v.string(),
  authorActorId: v.string(),
  issueSummaries: v.array(v.string()),
  recommendedDisposition: v.string(),
  reliefEvaluation: reliefEvaluationValidator,
  risks: v.array(v.string()),
  createdAt: v.string(),
})

export const panelVoteValidator = v.object({
  id: v.string(),
  judgeActorId: v.string(),
  vote: v.union(
    v.literal('affirm'),
    v.literal('reverse'),
    v.literal('vacate'),
    v.literal('vacate_in_part'),
    v.literal('dismiss'),
    v.literal('remand'),
  ),
  reliefOption: v.string(),
  rationale: v.string(),
  joinsMajority: v.boolean(),
  separateWritingType: v.optional(
    v.union(
      v.literal('concurrence'),
      v.literal('dissent'),
      v.literal('concur_in_judgment'),
    ),
  ),
  confidence: v.number(),
  createdAt: v.string(),
})

export const panelDispositionRecordValidator = v.object({
  id: v.string(),
  disposition: v.string(),
  judgmentText: v.string(),
  majorityJudgeActorIds: v.array(v.string()),
  separateOpinions: v.array(
    v.object({
      judgeActorId: v.string(),
      type: v.union(
        v.literal('concurrence'),
        v.literal('dissent'),
        v.literal('concur_in_judgment'),
      ),
      text: v.string(),
    }),
  ),
  votes: v.array(panelVoteValidator),
  ruleRefs: v.array(ruleRefValidator),
  createdAt: v.string(),
})

export const panelDeliberationValidator = v.object({
  id: v.string(),
  caseSessionId: v.string(),
  posture: v.union(
    v.literal('screening'),
    v.literal('voting'),
    v.literal('drafting'),
    v.literal('entered'),
  ),
  staffMemo: v.optional(v.string()),
  staffMemoRecord: v.optional(benchMemoValidator),
  votes: v.array(panelVoteValidator),
  majorityPosition: v.optional(
    v.union(
      v.literal('affirm'),
      v.literal('reverse'),
      v.literal('vacate'),
      v.literal('vacate_in_part'),
      v.literal('dismiss'),
      v.literal('remand'),
      v.literal('procedural_order'),
    ),
  ),
  dispositionText: v.optional(v.string()),
  separateWritingText: v.optional(v.string()),
  judgmentText: v.optional(v.string()),
  mandateStatus: v.union(
    v.literal('not_started'),
    v.literal('pending'),
    v.literal('issued'),
    v.literal('stayed'),
  ),
})

export const counterpartyStrategyValidator = v.object({
  id: v.string(),
  caseSessionId: v.string(),
  preservedIssues: v.array(v.string()),
  forfeitureArguments: v.array(v.string()),
  jurisdictionArguments: v.array(v.string()),
  meritsArguments: v.array(v.string()),
  proceduralMotions: v.array(v.string()),
  recommendedNextFilingEventId: v.optional(v.string()),
  updatedAt: v.optional(v.string()),
})

export const amicusCandidateValidator = v.object({
  id: v.string(),
  organizationName: v.string(),
  organizationType: v.union(
    v.literal('civil_rights_group'),
    v.literal('trade_association'),
    v.literal('government'),
    v.literal('academic_center'),
    v.literal('public_interest'),
  ),
  supportsRole: v.union(v.literal('appellant'), v.literal('appellee'), v.literal('neither')),
  interestStatement: v.string(),
  requiresLeave: v.boolean(),
  consentStatus: v.union(
    v.literal('all_parties_consent'),
    v.literal('partial_consent'),
    v.literal('no_consent'),
    v.literal('unknown'),
  ),
  recommended: v.boolean(),
  rationale: v.string(),
})

export const amicusParticipationValidator = v.object({
  candidates: v.array(amicusCandidateValidator),
  acceptedBriefIds: v.array(v.string()),
  deniedCandidateIds: v.array(v.string()),
})

export const ecfReceiptDocumentValidator = v.object({
  fileName: v.string(),
  attachmentType: v.union(
    v.literal('main'),
    v.literal('appendix'),
    v.literal('exhibit'),
    v.literal('certificate'),
    v.literal('motion_attachment'),
    v.literal('other'),
  ),
  sizeBytes: v.number(),
})

export const ecfReceiptValidator = v.object({
  id: v.string(),
  caseSessionId: v.string(),
  filingId: v.string(),
  receiptNumber: v.string(),
  filedTimestamp: v.optional(v.string()),
  filer: v.optional(participantRoleValidator),
  eventId: v.optional(v.string()),
  documentList: v.optional(v.array(ecfReceiptDocumentValidator)),
  noticeOfDocketActivityText: v.string(),
  serviceList: v.array(v.string()),
  docketText: v.optional(v.string()),
  warnings: v.optional(v.array(v.string())),
  deficiencies: v.optional(v.array(v.string())),
  nextExpectedDeadline: v.optional(
    v.object({
      label: v.string(),
      dueDate: v.string(),
      targetEventId: v.string(),
    }),
  ),
  createdAt: v.string(),
})

export const ecfEventCategoryValidator = v.union(
  v.literal('case_opening'),
  v.literal('appearance'),
  v.literal('brief'),
  v.literal('appendix'),
  v.literal('motion'),
  v.literal('response'),
  v.literal('sealed'),
  v.literal('post_disposition'),
  v.literal('amicus'),
)

export const ecfMetadataFieldValidator = v.object({
  key: v.string(),
  label: v.string(),
  inputType: v.union(
    v.literal('text'),
    v.literal('select'),
    v.literal('checkbox'),
    v.literal('date'),
    v.literal('docket_entry_ref'),
  ),
  required: v.boolean(),
  options: v.optional(v.array(v.string())),
})

export const ecfEventDefinitionValidator = v.object({
  eventId: v.string(),
  category: ecfEventCategoryValidator,
  displayName: v.string(),
  eligibleRoles: v.array(participantRoleValidator),
  requiresMainDocument: v.boolean(),
  requiredAttachments: v.array(v.string()),
  optionalAttachments: v.array(v.string()),
  metadataFields: v.array(ecfMetadataFieldValidator),
  menuPath: v.array(v.string()),
  courtEventCode: v.string(),
  requiresRelatedEntry: v.boolean(),
  requiresReliefText: v.boolean(),
  feeBehavior: v.union(
    v.literal('none'),
    v.literal('required'),
    v.literal('waivable'),
    v.literal('deferred'),
  ),
  serviceBehavior: v.union(
    v.literal('cm_ecf'),
    v.literal('manual_required'),
    v.literal('mixed'),
  ),
  partySelectionMode: v.union(
    v.literal('none'),
    v.literal('single'),
    v.literal('multiple'),
    v.literal('all_filers'),
  ),
  receiptTemplateId: v.string(),
})

export const ecfEventAvailabilityValidator = v.object({
  eventId: v.string(),
  category: ecfEventCategoryValidator,
  displayName: v.string(),
  courtEventName: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  sourceVersionIds: v.optional(v.array(v.string())),
  reliefOptions: v.optional(v.array(v.string())),
  eligibleRoles: v.array(participantRoleValidator),
  requiresMainDocument: v.boolean(),
  requiredAttachments: v.array(v.string()),
  optionalAttachments: v.array(v.string()),
  metadataFields: v.array(ecfMetadataFieldValidator),
  menuPath: v.array(v.string()),
  courtEventCode: v.string(),
  requiresRelatedEntry: v.boolean(),
  requiresReliefText: v.boolean(),
  feeBehavior: v.union(
    v.literal('none'),
    v.literal('required'),
    v.literal('waivable'),
    v.literal('deferred'),
  ),
  serviceBehavior: v.union(
    v.literal('cm_ecf'),
    v.literal('manual_required'),
    v.literal('mixed'),
  ),
  partySelectionMode: v.union(
    v.literal('none'),
    v.literal('single'),
    v.literal('multiple'),
    v.literal('all_filers'),
  ),
  receiptTemplateId: v.string(),
  available: v.boolean(),
  unavailableReasons: v.array(v.string()),
  availabilityReason: v.optional(v.string()),
})

export const caseSessionValidator = v.object({
  id: v.string(),
  scenario: scenarioValidator,
  courtPackId: v.string(),
  status: caseStatusValidator,
  procedureState: v.optional(procedureStateValidator),
  autonomyMode: autonomyModeValidator,
  turnPolicy: turnPolicyValidator,
  sourceProfileId: v.optional(v.string()),
  qualityState: qualityStateValidator,
  legalTrainingDisclaimerAcceptedAt: v.optional(v.string()),
  simulatedDate: v.string(),
  participants: v.array(participantValidator),
  docketEntries: v.array(docketEntryValidator),
  deadlines: v.array(deadlineValidator),
  filings: v.array(filingRecordValidator),
  ecfReceipts: v.optional(v.array(ecfReceiptValidator)),
  counterpartyStrategy: v.optional(counterpartyStrategyValidator),
  amicusParticipation: v.optional(amicusParticipationValidator),
  panelAssignment: v.optional(panelAssignmentValidator),
  benchMemo: v.optional(benchMemoValidator),
  panelDeliberation: v.optional(panelDeliberationValidator),
  panelDisposition: v.optional(panelDispositionRecordValidator),
  assessment: v.optional(assessmentValidator),
  actorWorkProducts: v.optional(v.array(actorWorkProductValidator)),
  simulationTurns: v.optional(
    v.array(
      v.object({
        id: v.string(),
        caseSessionId: v.string(),
        turnNumber: v.number(),
        actorId: v.string(),
        kind: v.union(
          v.literal('clerk'),
          v.literal('appellee'),
          v.literal('amicus'),
          v.literal('staff_attorney'),
          v.literal('judge_vote'),
          v.literal('panel_conference'),
          v.literal('judgment'),
          v.literal('mandate'),
        ),
        status: v.union(
          v.literal('pending'),
          v.literal('accepted'),
          v.literal('rejected'),
          v.literal('applied'),
        ),
        startedAt: v.string(),
        completedAt: v.optional(v.string()),
        effects: v.array(v.string()),
        inputSnapshotHash: v.string(),
        outputSnapshotHash: v.string(),
        validatorVersion: v.string(),
        retryCount: v.number(),
        stoppedReason: v.optional(v.string()),
        rawActorPacketStorageId: v.optional(v.string()),
        rawProviderResultStorageId: v.optional(v.string()),
      }),
    ),
  ),
})

export const caseSessionSummaryValidator = v.object({
  id: v.string(),
  scenarioTitle: v.string(),
  shortCaption: v.string(),
  status: caseStatusValidator,
  simulatedDate: v.string(),
  createdAt: v.number(),
})
