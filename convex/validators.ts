import { v } from 'convex/values'

export const participantRoleValidator = v.union(
  v.literal('appellant'),
  v.literal('appellee'),
  v.literal('petitioner'),
  v.literal('respondent'),
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

export const autonomyModeValidator = v.union(
  v.literal('paused'),
  v.literal('supervised'),
  v.literal('autonomous'),
)

export const turnPolicyValidator = v.object({
  maxTurnsPerRun: v.number(),
  requireHumanApprovalFor: v.array(v.string()),
  stopOnDeficiency: v.boolean(),
})

export const qualityStateValidator = v.union(
  v.literal('draft'),
  v.literal('source_review_pending'),
  v.literal('source_reviewed'),
  v.literal('eval_ready'),
  v.literal('beta_approved'),
  v.literal('production_approved'),
)

export const procedureStateValidator = v.union(
  v.literal('case_opened'),
  v.literal('notice_pending'),
  v.literal('jurisdiction_review'),
  v.literal('appearance_pending'),
  v.literal('fee_or_ifp_pending'),
  v.literal('record_pending'),
  v.literal('docketing_statement_pending'),
  v.literal('record_ordering_pending'),
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
  sourceVersionIds: v.optional(v.array(v.string())),
  code: v.optional(v.string()),
  cureSuggestion: v.optional(v.string()),
})

export const textExtractionStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('extracted'),
  v.literal('not_searchable'),
  v.literal('failed'),
  v.literal('fallback'),
)

export const documentSectionValidator = v.object({
  id: v.string(),
  label: v.string(),
  startIndex: v.number(),
  endIndex: v.optional(v.number()),
  textSnippet: v.string(),
})

export const documentAnalysisValidator = v.object({
  analyzerId: v.string(),
  pageCount: v.optional(v.number()),
  fileSizeBytes: v.number(),
  mimeType: v.string(),
  searchableText: v.boolean(),
  extractedPageText: v.optional(
    v.array(
      v.object({
        pageNumber: v.number(),
        text: v.string(),
      }),
    ),
  ),
  normalizedText: v.optional(v.string()),
  wordCount: v.optional(v.number()),
  sectionMap: v.optional(v.array(documentSectionValidator)),
  certificateOfServiceDetected: v.boolean(),
  certificateOfComplianceDetected: v.boolean(),
  certificateSnippets: v.optional(v.array(v.string())),
  legalCitations: v.optional(v.array(v.string())),
  recordCitations: v.optional(v.array(v.string())),
  appendixCitations: v.optional(v.array(v.string())),
  sealedOrRedactionWarning: v.boolean(),
  privacySealWarnings: v.optional(v.array(v.string())),
  textExtractionStatus: v.optional(textExtractionStatusValidator),
  extractionConfidence: v.optional(v.number()),
  warnings: v.array(v.string()),
})

export const documentAnalysisRecordValidator = v.object({
  id: v.string(),
  caseSessionId: v.string(),
  documentId: v.optional(v.string()),
  analysis: documentAnalysisValidator,
  createdAt: v.string(),
})

export const uploadedDocumentValidator = v.object({
  id: v.string(),
  fileName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  storageId: v.optional(v.string()),
  sha256: v.optional(v.string()),
  pageCount: v.optional(v.number()),
  extractedText: v.optional(v.string()),
  textExtractionStatus: v.optional(textExtractionStatusValidator),
  wordCount: v.optional(v.number()),
  analysisId: v.optional(v.string()),
  analysis: v.optional(documentAnalysisValidator),
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
  filingAttorneyName: v.optional(v.string()),
  representedPartyId: v.optional(v.string()),
  representedPartyIds: v.optional(v.array(v.string())),
  selectedReliefs: v.optional(v.array(v.string())),
  feePaymentStatus: v.optional(
    v.union(
      v.literal('not_required'),
      v.literal('paid'),
      v.literal('deferred'),
      v.literal('waived'),
      v.literal('pending'),
    ),
  ),
  feeTransactionStub: v.optional(
    v.object({
      transactionId: v.string(),
      amountCents: v.number(),
      status: v.union(
        v.literal('simulated_paid'),
        v.literal('waived'),
        v.literal('deferred'),
        v.literal('pending'),
      ),
    }),
  ),
  reliefRequested: v.optional(v.string()),
  serviceMethod: v.union(
    v.literal('cm_ecf'),
    v.literal('mail'),
    v.literal('email'),
    v.literal('hand_delivery'),
    v.literal('none'),
  ),
  relatedDocketEntryId: v.optional(v.string()),
  relatedDocketEntryIds: v.optional(v.array(v.string())),
  serviceRecipientIds: v.optional(v.array(v.string())),
  consentStatus: v.optional(
    v.union(
      v.literal('all_parties_consent'),
      v.literal('partial_consent'),
      v.literal('no_consent'),
      v.literal('unknown'),
    ),
  ),
  sealedDocumentType: v.optional(v.string()),
  sealedAccessMode: v.optional(
    v.union(
      v.literal('public'),
      v.literal('sealed'),
      v.literal('court_only'),
      v.literal('selected_parties'),
    ),
  ),
  privacyAcknowledged: v.optional(v.boolean()),
  privacyReview: v.optional(
    v.object({
      completed: v.boolean(),
      reviewerRole: v.union(v.literal('learner'), v.literal('instructor'), v.literal('clerk_ai')),
      warnings: v.array(v.string()),
    }),
  ),
  publicRedactedVersionIncluded: v.optional(v.boolean()),
  redactedPublicVersionDocumentId: v.optional(v.string()),
  paperCopyRequirement: v.optional(
    v.object({
      required: v.boolean(),
      copies: v.number(),
      dueDate: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  ),
  serviceListOverrides: v.optional(
    v.object({
      additionalRecipients: v.optional(v.array(v.string())),
      suppressedParticipantIds: v.optional(v.array(v.string())),
      manualServiceRecipients: v.optional(v.array(v.string())),
    }),
  ),
  feeWaiverRequested: v.optional(v.boolean()),
  emergency: v.boolean(),
  sealed: v.boolean(),
  redactionAcknowledged: v.boolean(),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
})

export const filingSubmissionValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  filerPartyId: v.optional(v.string()),
  partyIds: v.optional(v.array(v.string())),
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
  submissionJson: v.optional(v.string()),
  documentAnalysisIds: v.optional(v.array(v.string())),
  filerPartyId: v.optional(v.string()),
  partyIds: v.optional(v.array(v.string())),
})

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

export const scenarioRecordExcerptValidator = v.object({
  id: v.string(),
  label: v.string(),
  source: v.union(v.literal('synthetic'), v.literal('courtlistener'), v.literal('uploaded')),
  text: v.string(),
  citedByIssueIds: v.array(v.string()),
})

export const scenarioIssueValidator = v.object({
  id: v.string(),
  label: v.string(),
  standardOfReview: v.string(),
  preservationFacts: v.array(v.string()),
  recordSupportFacts: v.array(v.string()),
  likelyArgumentsForAppellant: v.array(v.string()),
  likelyArgumentsForAppellee: v.array(v.string()),
  possibleRelief: v.array(v.string()),
})

export const scenarioTrainingMetadataValidator = v.object({
  difficulty: v.union(
    v.literal('intro'),
    v.literal('intermediate'),
    v.literal('advanced'),
  ),
  practiceFocus: v.array(
    v.union(
      v.literal('jurisdiction'),
      v.literal('case_opening'),
      v.literal('motions'),
      v.literal('briefing'),
      v.literal('record_appendix'),
      v.literal('amicus'),
      v.literal('panel_merits'),
      v.literal('post_judgment'),
      v.literal('sealed_materials'),
    ),
  ),
  learningObjectives: v.array(v.string()),
  modeledPitfalls: v.array(v.string()),
  expectedProceduralPath: v.array(v.string()),
  likelyAmici: v.optional(
    v.array(
      v.object({
        organizationName: v.string(),
        organizationType: v.string(),
        supportsRole: v.union(
          v.literal('appellant'),
          v.literal('appellee'),
          v.literal('neither'),
        ),
        triggerIssueIds: v.array(v.string()),
        interestStatement: v.string(),
        requiresLeave: v.boolean(),
      }),
    ),
  ),
})

export const participantValidator = v.object({
  id: v.string(),
  displayName: v.string(),
  role: participantRoleValidator,
})

export const scenarioDocumentAssetValidator = v.object({
  id: v.string(),
  label: v.string(),
  fileName: v.string(),
  mimeType: v.literal('application/pdf'),
  source: v.union(
    v.literal('synthetic'),
    v.literal('courtlistener'),
    v.literal('uploaded'),
  ),
  publicUrl: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  storageId: v.optional(v.string()),
  sha256: v.optional(v.string()),
  sizeBytes: v.number(),
  pageCount: v.number(),
  extractedText: v.optional(v.string()),
})

export const scenarioTrialDocketEntryValidator = v.object({
  id: v.string(),
  entryNumber: v.number(),
  filedAt: v.string(),
  title: v.string(),
  text: v.string(),
  documentAssetIds: v.array(v.string()),
})

export const scenarioTrialDocketValidator = v.object({
  caption: v.string(),
  court: v.string(),
  docketNumber: v.string(),
  sourceUrl: v.optional(v.string()),
  entries: v.array(scenarioTrialDocketEntryValidator),
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
  issues: v.optional(v.array(scenarioIssueValidator)),
  recordExcerpts: v.optional(v.array(scenarioRecordExcerptValidator)),
  training: v.optional(scenarioTrainingMetadataValidator),
  participants: v.optional(v.array(participantValidator)),
  sourceCaseUrl: v.optional(v.string()),
  trialDocket: v.optional(scenarioTrialDocketValidator),
  documentAssets: v.optional(v.array(scenarioDocumentAssetValidator)),
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
    tool: v.literal('draftStaffMemo'),
    actorId: v.string(),
    text: v.string(),
    issueSummaries: v.array(v.string()),
    recommendedDisposition: v.string(),
    risks: v.array(v.string()),
  }),
  v.object({
    tool: v.literal('castRuntimePanelVote'),
    actorId: v.string(),
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
  }),
  v.object({
    tool: v.literal('draftRuntimePanelDisposition'),
    actorId: v.string(),
    disposition: v.string(),
    text: v.string(),
    judgmentText: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('enterJudgment'),
    actorId: v.string(),
    disposition: v.string(),
    judgmentText: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('setMandateDeadline'),
    actorId: v.string(),
    label: v.string(),
    offsetDays: v.number(),
    sourceRuleRefs: v.array(ruleRefValidator),
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
  id: v.string(),
  entryNumber: v.number(),
  filedAt: v.string(),
  title: v.string(),
  text: v.string(),
  documents: v.array(scenarioDocumentAssetValidator),
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
