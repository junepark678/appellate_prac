import type {
  CourtProcedureProfile,
  CourtSourceVersion,
  DeadlineRule,
  RuleRef,
  SourceBackedConstraint,
} from '../types'

export const FRAP_SOURCE_URL =
  'https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-appellate-procedure'
export const FEDERAL_CM_ECF_URL = 'https://www.uscourts.gov/court-records/electronic-filing-cm-ecf'
export const CA4_LOCAL_RULES_URL = 'https://www.ca4.uscourts.gov/rules/toc.html'
export const CA4_ECF_EVENTS_URL =
  'https://www.ca4.uscourts.gov/caseinformationefiling/efiling_cm-ecf/filingevents'
export const CA4_ECF_RULES_URL =
  'https://www.ca4.uscourts.gov/caseinformationefiling/efiling_cm-ecf/ecfrules'
export const CA4_FEE_SCHEDULE_URL = 'https://www.ca4.uscourts.gov/court-forms-fees/fee-schedule'
export const CA4_FORMS_URL = 'https://www.ca4.uscourts.gov/court-forms-fees/forms-by-category'
export const CA4_NOTICES_URL = 'https://www.ca4.uscourts.gov/news-announcements'

export const ca4SourceVersionIds = {
  frap2025: 'frap-effective-2025-12-01',
  federalCmEcf2026: 'federal-cm-ecf-current-2026-05-25',
  ca4LocalRules2026: 'ca4-local-rules-current-2026-03-23',
  ca4EcfEvents2026: 'ca4-ecf-events-current-2026-03-23',
  ca4EcfRules2026: 'ca4-ecf-local-rules-current-2026-05-25',
  ca4FeeSchedule2026: 'ca4-fee-schedule-current-2026-05-25',
  ca4Forms2026: 'ca4-forms-current-2026-05-25',
  ca4Notices2026: 'ca4-notices-current-2026-05-25',
} as const

export const ca4CourtSourceVersions: CourtSourceVersion[] = [
  {
    sourceVersionId: ca4SourceVersionIds.frap2025,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Federal Rules of Appellate Procedure, amendments effective December 1, 2025',
    sourceUrl: FRAP_SOURCE_URL,
    effectiveFrom: '2025-12-01',
    contentHash: 'sha256:b5edb26f7006631087a61dd8912a68c46fa0c845ce1578d53ee1c02811f65a1f',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'frap',
  },
  {
    sourceVersionId: ca4SourceVersionIds.federalCmEcf2026,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Federal CM/ECF overview, current May 25, 2026',
    sourceUrl: FEDERAL_CM_ECF_URL,
    effectiveFrom: '2026-05-25',
    contentHash: 'sha256:1694f455103b328135c30f263654ef0d57746d9905730ffeb01fe58b2b506a54',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'cm_ecf_reference',
  },
  {
    sourceVersionId: ca4SourceVersionIds.ca4LocalRules2026,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Fourth Circuit Local Rules and Internal Operating Procedures, current May 25, 2026',
    sourceUrl: CA4_LOCAL_RULES_URL,
    effectiveFrom: '2026-05-25',
    contentHash: 'sha256:b0814cf996904812e38301f978a663c251a9aafc22b18ace146a0b431cf53778',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'local_rules',
  },
  {
    sourceVersionId: ca4SourceVersionIds.ca4EcfEvents2026,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Fourth Circuit CM/ECF Filing Events and Reliefs, current May 25, 2026',
    sourceUrl: CA4_ECF_EVENTS_URL,
    effectiveFrom: '2026-05-25',
    contentHash: 'sha256:4410081e5e8a543405db8c319498c443d785fc4655b3a02d5ccc630bf9bdfffd',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'ecf_event_catalog',
  },
  {
    sourceVersionId: ca4SourceVersionIds.ca4EcfRules2026,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Fourth Circuit CM/ECF local rules, current May 25, 2026',
    sourceUrl: CA4_ECF_RULES_URL,
    effectiveFrom: '2026-05-25',
    contentHash: 'sha256:06db9fd0726ab7fb66bec169686260b4db472240955bcf9676f45be276eb24f2',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'ecf_local_rules',
  },
  {
    sourceVersionId: ca4SourceVersionIds.ca4FeeSchedule2026,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Fourth Circuit fee schedule, current May 25, 2026',
    sourceUrl: CA4_FEE_SCHEDULE_URL,
    effectiveFrom: '2026-05-25',
    contentHash: 'sha256:5c8dac03e3b597e7a710f58d9f648d18cc9943cbf07840bb3c6c6cad807e4d5b',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'fee_schedule',
  },
  {
    sourceVersionId: ca4SourceVersionIds.ca4Forms2026,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Fourth Circuit forms by category, current May 25, 2026',
    sourceUrl: CA4_FORMS_URL,
    effectiveFrom: '2026-05-25',
    contentHash: 'sha256:cb9806b4c62b3d162e71bedb970ce11d083ba266af65a213f635ea2da5c3d729',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'forms',
  },
  {
    sourceVersionId: ca4SourceVersionIds.ca4Notices2026,
    courtPackId: 'us-federal-ca4-civil-appeal',
    label: 'Fourth Circuit news and notices, current May 25, 2026',
    sourceUrl: CA4_NOTICES_URL,
    effectiveFrom: '2026-05-25',
    contentHash: 'sha256:8d5f6ffc39e8202129950f78ec8e20cc3a9468479f2bb42246333af871223c47',
    reviewStatus: 'published',
    publishedAt: '2026-05-25T00:00:00.000+09:00',
    parserVersion: 'html-normalized-sha256-v1',
    sourceKind: 'court_notices',
  },
]

export const ca4ProcedureProfile: CourtProcedureProfile = {
  courtPackId: 'us-federal-ca4-civil-appeal',
  activeRulePackIds: ['frap-civil-appeal', 'ca4-local-civil-appeal'],
  activeEcfCatalogId: 'ca4-ecf-catalog-2026-03-23',
  activeDeadlineSetId: 'ca4-deadlines-2026-03-23',
  sourceVersionIds: Object.values(ca4SourceVersionIds),
}

export const ca4SourceUrlByVersionId = Object.fromEntries(
  ca4CourtSourceVersions.map((source) => [source.sourceVersionId, source.sourceUrl]),
) as Record<string, string>

export function sourceUrlsForVersionIds(sourceVersionIds: string[]) {
  return sourceVersionIds
    .map((sourceVersionId) => ca4SourceUrlByVersionId[sourceVersionId])
    .filter((sourceUrl, index, values): sourceUrl is string =>
      Boolean(sourceUrl) && values.indexOf(sourceUrl) === index,
    )
}

const ref = (ruleId: string, label: string, sourceUrl = FRAP_SOURCE_URL): RuleRef => ({
  ruleId,
  label,
  sourceUrl,
})

export const ca4DeadlineRuleRefs = {
  frap4: ref('FRAP_4_A_1', 'Fed. R. App. P. 4(a)(1)'),
  frap26: ref('FRAP_26', 'Fed. R. App. P. 26'),
  frap27: ref('FRAP_27', 'Fed. R. App. P. 27'),
  frap29: ref('FRAP_29', 'Fed. R. App. P. 29'),
  frap31: ref('FRAP_31', 'Fed. R. App. P. 31'),
  frap39: ref('FRAP_39', 'Fed. R. App. P. 39'),
  frap40: ref('FRAP_40', 'Fed. R. App. P. 40'),
  frap41: ref('FRAP_41', 'Fed. R. App. P. 41'),
  ca4Local31: ref('CA4_LR_31', '4th Cir. Loc. R. 31', CA4_LOCAL_RULES_URL),
  ca4Local39: ref('CA4_LR_39', '4th Cir. Loc. R. 39', CA4_LOCAL_RULES_URL),
  ca4Local40: ref('CA4_LR_40', '4th Cir. Loc. R. 40', CA4_LOCAL_RULES_URL),
  ca4Local41: ref('CA4_LR_41', '4th Cir. Loc. R. 41', CA4_LOCAL_RULES_URL),
}

export const ca4DeadlineRules: DeadlineRule[] = [
  {
    deadlineId: 'notice_of_appeal_30_days',
    triggerEventId: 'civil_judgment',
    targetEventId: 'notice_of_appeal',
    offset: 30,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap4, ca4DeadlineRuleRefs.frap26],
  },
  {
    deadlineId: 'motion_response_10_days',
    triggerEventId: 'motion',
    targetEventId: 'motion_response',
    offset: 10,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap27, ca4DeadlineRuleRefs.frap26],
  },
  {
    deadlineId: 'stay_motion_response_7_days',
    triggerEventId: 'motion_stay_pending_appeal',
    targetEventId: 'motion_response',
    offset: 7,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap27, ca4DeadlineRuleRefs.frap26],
  },
  {
    deadlineId: 'amicus_motion_response_7_days',
    triggerEventId: 'motion_for_leave_to_file_amicus',
    targetEventId: 'response_to_amicus_motion',
    offset: 7,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap29, ca4DeadlineRuleRefs.frap26],
  },
  {
    deadlineId: 'opening_brief_40_days',
    triggerEventId: 'briefing_schedule',
    targetEventId: 'opening_brief',
    offset: 40,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap31, ca4DeadlineRuleRefs.frap26, ca4DeadlineRuleRefs.ca4Local31],
  },
  {
    deadlineId: 'appellee_brief_30_days',
    triggerEventId: 'opening_brief',
    targetEventId: 'appellee_brief',
    offset: 30,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap31, ca4DeadlineRuleRefs.frap26, ca4DeadlineRuleRefs.ca4Local31],
  },
  {
    deadlineId: 'reply_brief_21_days',
    triggerEventId: 'appellee_brief',
    targetEventId: 'reply_brief',
    offset: 21,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap31, ca4DeadlineRuleRefs.frap26, ca4DeadlineRuleRefs.ca4Local31],
  },
  {
    deadlineId: 'rehearing_14_days',
    triggerEventId: 'judgment_entered',
    targetEventId: 'petition_rehearing',
    offset: 14,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap40, ca4DeadlineRuleRefs.frap26, ca4DeadlineRuleRefs.ca4Local40],
  },
  {
    deadlineId: 'bill_of_costs_14_days',
    triggerEventId: 'judgment_entered',
    targetEventId: 'bill_of_costs',
    offset: 14,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap39, ca4DeadlineRuleRefs.frap26, ca4DeadlineRuleRefs.ca4Local39],
  },
  {
    deadlineId: 'mandate_21_days',
    triggerEventId: 'judgment_entered',
    targetEventId: 'mandate',
    offset: 21,
    unit: 'calendar_day',
    businessDayRule: 'carry_forward',
    holidayCalendarId: 'us_federal_2026',
    ruleRefs: [ca4DeadlineRuleRefs.frap41, ca4DeadlineRuleRefs.frap26, ca4DeadlineRuleRefs.ca4Local41],
  },
]

export const ca4SourceBackedConstraints: SourceBackedConstraint[] = [
  {
    constraintId: 'ca4_ecf_motion_relief_required',
    ruleRefs: [ca4DeadlineRuleRefs.frap27],
    sourceVersionIds: [ca4SourceVersionIds.frap2025, ca4SourceVersionIds.ca4EcfEvents2026],
    kind: 'relief_selection',
    appliesToEventIds: ['motion', 'motion_extend_time', 'motion_overlength_brief', 'motion_to_seal', 'motion_stay_pending_appeal', 'mandate_stay_motion'],
    severity: 'error',
    predicateJson: JSON.stringify({ metadata: 'reliefRequested', required: true }),
    cureSuggestion: 'Select or enter the motion relief before filing.',
  },
  {
    constraintId: 'ca4_related_entry_required',
    ruleRefs: [ca4DeadlineRuleRefs.frap27],
    sourceVersionIds: [ca4SourceVersionIds.ca4EcfEvents2026],
    kind: 'related_entry',
    appliesToEventIds: ['motion_response', 'response_to_amicus_motion', 'corrected_brief', 'mandate_stay_motion', 'motion_stay_pending_appeal', 'motion_extend_time'],
    severity: 'error',
    predicateJson: JSON.stringify({ metadata: 'relatedDocketEntryId', required: true }),
    cureSuggestion: 'Select the docket entry this filing relates to.',
  },
  {
    constraintId: 'ca4_sealed_public_redacted_required',
    ruleRefs: [ca4DeadlineRuleRefs.frap26],
    sourceVersionIds: [ca4SourceVersionIds.frap2025, ca4SourceVersionIds.ca4LocalRules2026],
    kind: 'sealed_filing',
    appliesToEventIds: ['motion_to_seal', 'sealed_filing_acknowledgment'],
    severity: 'error',
    predicateJson: JSON.stringify({ sealedBehavior: 'public_redacted_required' }),
    cureSuggestion: 'Identify sealed material and include or certify a public redacted version.',
  },
  {
    constraintId: 'frap40_rehearing_after_judgment',
    ruleRefs: [ca4DeadlineRuleRefs.frap40, ca4DeadlineRuleRefs.ca4Local40],
    sourceVersionIds: [ca4SourceVersionIds.frap2025, ca4SourceVersionIds.ca4LocalRules2026],
    kind: 'event_sequence',
    appliesToEventIds: ['petition_rehearing'],
    severity: 'error',
    predicateJson: JSON.stringify({ requiresProcedureState: 'judgment_entered' }),
    cureSuggestion: 'Wait until judgment is entered before filing rehearing papers.',
  },
  {
    constraintId: 'frap39_costs_after_judgment',
    ruleRefs: [ca4DeadlineRuleRefs.frap39, ca4DeadlineRuleRefs.ca4Local39],
    sourceVersionIds: [ca4SourceVersionIds.frap2025, ca4SourceVersionIds.ca4LocalRules2026],
    kind: 'event_sequence',
    appliesToEventIds: ['bill_of_costs'],
    severity: 'error',
    predicateJson: JSON.stringify({ requiresProcedureState: 'judgment_entered' }),
    cureSuggestion: 'File costs only after judgment and within the cost window.',
  },
]

export function deadlineRuleForTrigger(triggerEventId: string, targetEventId?: string) {
  return ca4DeadlineRules.find(
    (rule) =>
      rule.triggerEventId === triggerEventId &&
      (!targetEventId || rule.targetEventId === targetEventId),
  )
}
