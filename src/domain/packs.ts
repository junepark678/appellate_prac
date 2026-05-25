import type {
  AiActor,
  CourtPack,
  DeadlineEffect,
  FilingEvent,
  RuleItem,
  RulePack,
  RuleRef,
  Scenario,
} from './types'
import scenarioSeed from './scenarios.seed.json'

const usCourtsFrapSource =
  'https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-appellate-procedure'

const ca4RulesSource = 'https://www.ca4.uscourts.gov/LocalRules/toc.html'
const ca4RulesAndProceduresSource = 'https://www.ca4.uscourts.gov/rules-and-procedures'
const ca4Rule4Source = 'https://www.ca4.uscourts.gov/rules/Rule4.html'
const ca4Rule9Source = 'https://www.ca4.uscourts.gov/rules/Rule9.html'
const ca4Rule15Source = 'https://www.ca4.uscourts.gov/rules/Rule15.html'
const ca4Rule16Source = 'https://www.ca4.uscourts.gov/rules/Rule16.html'
const ca4Rule17Source = 'https://www.ca4.uscourts.gov/rules/Rule17.html'
const ca4Rule18Source = 'https://www.ca4.uscourts.gov/rules/Rule18.html'
const ca4Rule19Source = 'https://www.ca4.uscourts.gov/rules/Rule19.html'
const ca4Rule20Source = 'https://www.ca4.uscourts.gov/rules/Rule20.html'
const ca4Rule21Source = 'https://www.ca4.uscourts.gov/rules/Rule21.html'
const ca4LocalRule31Source = 'https://www.ca4.uscourts.gov/LocalRules/LocalRules.3.22.html'
const ca4EcfEventsSource =
  'https://www.ca4.uscourts.gov/caseinformationefiling/efiling_cm-ecf/filingevents'

export const ruleRefs = {
  frap3: {
    ruleId: 'FRAP_3',
    label: 'Fed. R. App. P. 3',
    sourceUrl: usCourtsFrapSource,
  },
  frap4: {
    ruleId: 'FRAP_4_A_1',
    label: 'Fed. R. App. P. 4(a)(1)',
    sourceUrl: usCourtsFrapSource,
  },
  frap4b: {
    ruleId: 'FRAP_4_B',
    label: 'Fed. R. App. P. 4(b)',
    sourceUrl: ca4Rule4Source,
  },
  frap8: {
    ruleId: 'FRAP_8',
    label: 'Fed. R. App. P. 8',
    sourceUrl: usCourtsFrapSource,
  },
  frap9: {
    ruleId: 'FRAP_9',
    label: 'Fed. R. App. P. 9',
    sourceUrl: ca4Rule9Source,
  },
  frap10: {
    ruleId: 'FRAP_10',
    label: 'Fed. R. App. P. 10',
    sourceUrl: usCourtsFrapSource,
  },
  frap15: {
    ruleId: 'FRAP_15',
    label: 'Fed. R. App. P. 15',
    sourceUrl: ca4Rule15Source,
  },
  frap16: {
    ruleId: 'FRAP_16',
    label: 'Fed. R. App. P. 16',
    sourceUrl: ca4Rule16Source,
  },
  frap17: {
    ruleId: 'FRAP_17',
    label: 'Fed. R. App. P. 17',
    sourceUrl: ca4Rule17Source,
  },
  frap18: {
    ruleId: 'FRAP_18',
    label: 'Fed. R. App. P. 18',
    sourceUrl: ca4Rule18Source,
  },
  frap19: {
    ruleId: 'FRAP_19',
    label: 'Fed. R. App. P. 19',
    sourceUrl: ca4Rule19Source,
  },
  frap20: {
    ruleId: 'FRAP_20',
    label: 'Fed. R. App. P. 20',
    sourceUrl: ca4Rule20Source,
  },
  frap21: {
    ruleId: 'FRAP_21',
    label: 'Fed. R. App. P. 21',
    sourceUrl: ca4Rule21Source,
  },
  frap25: {
    ruleId: 'FRAP_25',
    label: 'Fed. R. App. P. 25',
    sourceUrl: usCourtsFrapSource,
  },
  frap26: {
    ruleId: 'FRAP_26',
    label: 'Fed. R. App. P. 26',
    sourceUrl: usCourtsFrapSource,
  },
  frap26_1: {
    ruleId: 'FRAP_26_1',
    label: 'Fed. R. App. P. 26.1',
    sourceUrl: usCourtsFrapSource,
  },
  frap27: {
    ruleId: 'FRAP_27',
    label: 'Fed. R. App. P. 27',
    sourceUrl: usCourtsFrapSource,
  },
  frap28: {
    ruleId: 'FRAP_28',
    label: 'Fed. R. App. P. 28',
    sourceUrl: usCourtsFrapSource,
  },
  frap29: {
    ruleId: 'FRAP_29',
    label: 'Fed. R. App. P. 29',
    sourceUrl: usCourtsFrapSource,
  },
  frap30: {
    ruleId: 'FRAP_30',
    label: 'Fed. R. App. P. 30',
    sourceUrl: usCourtsFrapSource,
  },
  frap31: {
    ruleId: 'FRAP_31',
    label: 'Fed. R. App. P. 31',
    sourceUrl: usCourtsFrapSource,
  },
  frap32: {
    ruleId: 'FRAP_32',
    label: 'Fed. R. App. P. 32',
    sourceUrl: usCourtsFrapSource,
  },
  frap34: {
    ruleId: 'FRAP_34',
    label: 'Fed. R. App. P. 34',
    sourceUrl: usCourtsFrapSource,
  },
  frap36: {
    ruleId: 'FRAP_36',
    label: 'Fed. R. App. P. 36',
    sourceUrl: usCourtsFrapSource,
  },
  frap39: {
    ruleId: 'FRAP_39',
    label: 'Fed. R. App. P. 39',
    sourceUrl: usCourtsFrapSource,
  },
  frap40: {
    ruleId: 'FRAP_40',
    label: 'Fed. R. App. P. 40',
    sourceUrl: usCourtsFrapSource,
  },
  frap41: {
    ruleId: 'FRAP_41',
    label: 'Fed. R. App. P. 41',
    sourceUrl: usCourtsFrapSource,
  },
  ca4Local12: {
    ruleId: 'CA4_LR_12',
    label: '4th Cir. Loc. R. 12',
    sourceUrl: ca4RulesSource,
  },
  ca4Local3: {
    ruleId: 'CA4_LR_3',
    label: '4th Cir. Loc. R. 3',
    sourceUrl: ca4RulesSource,
  },
  ca4Local8: {
    ruleId: 'CA4_LR_8',
    label: '4th Cir. Loc. R. 8',
    sourceUrl: ca4RulesSource,
  },
  ca4Local9: {
    ruleId: 'CA4_LR_9',
    label: '4th Cir. Loc. R. 9',
    sourceUrl: ca4Rule9Source,
  },
  ca4Local10: {
    ruleId: 'CA4_LR_10',
    label: '4th Cir. Loc. R. 10',
    sourceUrl: ca4RulesSource,
  },
  ca4Local11: {
    ruleId: 'CA4_LR_11',
    label: '4th Cir. Loc. R. 11',
    sourceUrl: ca4RulesSource,
  },
  ca4Local15: {
    ruleId: 'CA4_LR_15',
    label: '4th Cir. Loc. R. 15',
    sourceUrl: ca4Rule15Source,
  },
  ca4Local18: {
    ruleId: 'CA4_LR_18',
    label: '4th Cir. Loc. R. 18',
    sourceUrl: ca4Rule18Source,
  },
  ca4Local21: {
    ruleId: 'CA4_LR_21',
    label: '4th Cir. Loc. R. 21',
    sourceUrl: ca4Rule21Source,
  },
  ca4Local25: {
    ruleId: 'CA4_LR_25',
    label: '4th Cir. Loc. R. 25',
    sourceUrl: ca4RulesSource,
  },
  ca4Local26_1: {
    ruleId: 'CA4_LR_26_1',
    label: '4th Cir. Loc. R. 26.1',
    sourceUrl: ca4RulesSource,
  },
  ca4Local27: {
    ruleId: 'CA4_LR_27',
    label: '4th Cir. Loc. R. 27',
    sourceUrl: ca4RulesSource,
  },
  ca4Local28: {
    ruleId: 'CA4_LR_28',
    label: '4th Cir. Loc. R. 28',
    sourceUrl: ca4RulesSource,
  },
  ca4Local30: {
    ruleId: 'CA4_LR_30',
    label: '4th Cir. Loc. R. 30',
    sourceUrl: ca4RulesSource,
  },
  ca4Local31: {
    ruleId: 'CA4_LR_31',
    label: '4th Cir. Loc. R. 31',
    sourceUrl: ca4LocalRule31Source,
  },
  ca4Local32: {
    ruleId: 'CA4_LR_32',
    label: '4th Cir. Loc. R. 32',
    sourceUrl: ca4RulesSource,
  },
  ca4Local34: {
    ruleId: 'CA4_LR_34',
    label: '4th Cir. Loc. R. 34',
    sourceUrl: ca4RulesSource,
  },
  ca4Local39: {
    ruleId: 'CA4_LR_39',
    label: '4th Cir. Loc. R. 39',
    sourceUrl: ca4RulesSource,
  },
  ca4Local40: {
    ruleId: 'CA4_LR_40',
    label: '4th Cir. Loc. R. 40',
    sourceUrl: ca4RulesSource,
  },
  ca4Local41: {
    ruleId: 'CA4_LR_41',
    label: '4th Cir. Loc. R. 41',
    sourceUrl: ca4RulesSource,
  },
  ca4Local45: {
    ruleId: 'CA4_LR_45',
    label: '4th Cir. Loc. R. 45',
    sourceUrl: ca4RulesSource,
  },
} satisfies Record<string, RuleRef>

const openingBriefDeadline: DeadlineEffect = {
  targetEventId: 'opening_brief',
  offsetDays: 40,
  label: 'Opening brief and appendix due',
  sourceRuleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
}

const appelleeBriefDeadline: DeadlineEffect = {
  targetEventId: 'appellee_brief',
  offsetDays: 30,
  label: 'Appellee brief due',
  sourceRuleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
}

const replyBriefDeadline: DeadlineEffect = {
  targetEventId: 'reply_brief',
  offsetDays: 21,
  label: 'Reply brief due',
  sourceRuleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
}

const criminalOpeningBriefDeadline: DeadlineEffect = {
  targetEventId: 'opening_brief',
  offsetDays: 35,
  label: 'Criminal opening brief and appendix due',
  sourceRuleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
}

const criminalAppelleeBriefDeadline: DeadlineEffect = {
  targetEventId: 'appellee_brief',
  offsetDays: 21,
  label: 'Criminal appellee brief due',
  sourceRuleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
}

const criminalReplyBriefDeadline: DeadlineEffect = {
  targetEventId: 'reply_brief',
  offsetDays: 10,
  label: 'Criminal reply brief due',
  sourceRuleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
}

const pdfRequirement = (id: string, label: string, maxPages?: number) => ({
  id,
  label,
  required: true,
  acceptedMimeTypes: ['application/pdf'],
  maxPages,
})

type EcfEventMetadata = Pick<
  FilingEvent,
  | 'ecfMenuPath'
  | 'ecfCategory'
  | 'courtEventCode'
  | 'requiresRelatedEntry'
  | 'requiresReliefText'
  | 'feeBehavior'
  | 'serviceBehavior'
  | 'partySelectionMode'
  | 'receiptTemplateId'
>

type BaseFilingEvent = Omit<FilingEvent, keyof EcfEventMetadata>

const ecfEventMetadata = (
  menuPath: string[],
  category: FilingEvent['ecfCategory'],
  courtEventCode: string,
  options: Partial<
    Pick<
      EcfEventMetadata,
      | 'requiresRelatedEntry'
      | 'requiresReliefText'
      | 'feeBehavior'
      | 'serviceBehavior'
      | 'partySelectionMode'
      | 'receiptTemplateId'
    >
  > = {},
): EcfEventMetadata => ({
  ecfMenuPath: menuPath,
  ecfCategory: category,
  courtEventCode,
  requiresRelatedEntry: options.requiresRelatedEntry ?? false,
  requiresReliefText: options.requiresReliefText ?? category === 'motion',
  feeBehavior: options.feeBehavior ?? 'none',
  serviceBehavior: options.serviceBehavior ?? 'cm_ecf',
  partySelectionMode: options.partySelectionMode ?? 'single',
  receiptTemplateId: options.receiptTemplateId ?? 'standard_noda',
})

const ecfMetadataByEventId: Record<string, EcfEventMetadata> = {
  notice_of_appeal: ecfEventMetadata(
    ['Case Opening', 'Notice of Appeal'],
    'case_opening',
    'NOA',
    { feeBehavior: 'required', receiptTemplateId: 'case_opening_noda' },
  ),
  criminal_notice_of_appeal: ecfEventMetadata(
    ['Case Opening', 'Notice of Appeal - Criminal'],
    'case_opening',
    'CRIM_NOA',
    { feeBehavior: 'none', receiptTemplateId: 'case_opening_noda' },
  ),
  petition_for_review: ecfEventMetadata(
    ['Case Opening', 'Petition for Review'],
    'case_opening',
    'PET_REVIEW',
    { feeBehavior: 'required', receiptTemplateId: 'case_opening_noda' },
  ),
  petition_for_writ_mandamus: ecfEventMetadata(
    ['Case Opening', 'Petition for Writ of Mandamus/Prohibition'],
    'case_opening',
    'WRIT_PETITION',
    { feeBehavior: 'required', receiptTemplateId: 'case_opening_noda' },
  ),
  appearance_disclosure: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'Appearance of counsel / Disclosure statement'],
    'appearance',
    'APPEAR_DISC',
  ),
  docketing_statement: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'Docketing statement (civil/agency)'],
    'appearance',
    'DOCKET_STMT_CIV',
  ),
  criminal_docketing_statement: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'Docketing statement (criminal)'],
    'appearance',
    'DOCKET_STMT_CRIM',
  ),
  agency_docketing_statement: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'Docketing statement (civil/agency)'],
    'appearance',
    'DOCKET_STMT_AGENCY',
  ),
  writ_docketing_statement: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'Docketing statement'],
    'appearance',
    'DOCKET_STMT_WRIT',
  ),
  cja_financial_disclosure: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'CJA financial disclosure'],
    'appearance',
    'CJA_FIN_DISC',
    { serviceBehavior: 'manual_required' },
  ),
  transcript_order_acknowledgment: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'Transcript order form'],
    'appearance',
    'TRANSCRIPT_ACK',
  ),
  certified_agency_record: ecfEventMetadata(
    ['Other Filings', 'Certified list / agency record'],
    'appearance',
    'AGENCY_RECORD',
    { partySelectionMode: 'single' },
  ),
  motion_to_supplement_record: ecfEventMetadata(
    ['Motions, Responses & Replies', 'MOTION', 'Supplement record'],
    'motion',
    'MOTION_SUPP_RECORD',
    { requiresReliefText: true, requiresRelatedEntry: true },
  ),
  emergency_motion_stay: ecfEventMetadata(
    ['Motions, Responses & Replies', 'MOTION', 'Emergency stay'],
    'motion',
    'EMERGENCY_STAY',
    { requiresReliefText: true },
  ),
  appendix_to_writ_petition: ecfEventMetadata(
    ['Other Filings', 'Appendix to writ petition'],
    'appendix',
    'WRIT_APPENDIX',
  ),
  order_inviting_answer: ecfEventMetadata(
    ['Other Filings', 'Court order inviting answer'],
    'response',
    'WRIT_ANSWER_ORDER',
    { partySelectionMode: 'none' },
  ),
  answer_to_writ_petition: ecfEventMetadata(
    ['Other Filings', 'Answer to writ petition'],
    'response',
    'WRIT_ANSWER',
    { requiresRelatedEntry: true },
  ),
  reply_in_support_of_writ: ecfEventMetadata(
    ['Other Filings', 'Reply in support of writ petition'],
    'response',
    'WRIT_REPLY',
    { requiresRelatedEntry: true },
  ),
  writ_disposition: ecfEventMetadata(
    ['Judgments', 'Writ disposition'],
    'post_disposition',
    'WRIT_DISPOSITION',
    { partySelectionMode: 'none' },
  ),
  motion: ecfEventMetadata(['Motions, Responses & Replies', 'MOTION'], 'motion', 'MOTION', {
    requiresReliefText: true,
  }),
  motion_response: ecfEventMetadata(
    ['Motions, Responses & Replies', 'RESPONSE/ANSWER (to motion or request)'],
    'response',
    'MOTION_RESPONSE',
    { requiresRelatedEntry: true },
  ),
  motion_stay_pending_appeal: ecfEventMetadata(
    ['Motions, Responses & Replies', 'Motion to stay or injunction pending appeal'],
    'motion',
    'MOTION_STAY',
    { requiresReliefText: true, requiresRelatedEntry: true },
  ),
  opening_brief: ecfEventMetadata(
    ['Briefing Documents', 'BRIEF (formal briefs not under seal)'],
    'brief',
    'OPENING_BRIEF',
  ),
  joint_appendix: ecfEventMetadata(
    ['Briefing Documents', 'Joint Appendix'],
    'appendix',
    'JOINT_APPENDIX',
  ),
  appellee_brief: ecfEventMetadata(
    ['Briefing Documents', 'BRIEF (formal briefs not under seal)'],
    'brief',
    'APPELLEE_BRIEF',
  ),
  reply_brief: ecfEventMetadata(
    ['Briefing Documents', 'BRIEF (formal briefs not under seal)'],
    'brief',
    'REPLY_BRIEF',
  ),
  amicus_notice_or_consent: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'Notice / Consent statement'],
    'amicus',
    'AMICUS_NOTICE',
    { serviceBehavior: 'mixed' },
  ),
  motion_for_leave_to_file_amicus: ecfEventMetadata(
    ['Motions, Responses & Replies', 'Motion for leave to file amicus brief'],
    'motion',
    'AMICUS_LEAVE',
    { requiresReliefText: true, serviceBehavior: 'mixed' },
  ),
  response_to_amicus_motion: ecfEventMetadata(
    ['Motions, Responses & Replies', 'RESPONSE/ANSWER (to motion or request)'],
    'response',
    'AMICUS_RESPONSE',
    { requiresRelatedEntry: true },
  ),
  amicus_brief: ecfEventMetadata(
    ['Briefing Documents', 'Amicus Curiae/Intervenor Brief'],
    'amicus',
    'AMICUS_BRIEF',
    { serviceBehavior: 'mixed' },
  ),
  corrected_brief: ecfEventMetadata(
    ['Briefing Documents', 'Corrected Brief'],
    'brief',
    'CORRECTED_BRIEF',
    { requiresRelatedEntry: true },
  ),
  rule_28j_letter: ecfEventMetadata(
    ['Briefing Documents', 'Supplemental authorities'],
    'brief',
    'FRAP_28J',
  ),
  motion_extend_time: ecfEventMetadata(
    ['Motions, Responses & Replies', 'Motion to extend time'],
    'motion',
    'MOTION_EXT_TIME',
    { requiresReliefText: true, requiresRelatedEntry: true },
  ),
  motion_overlength_brief: ecfEventMetadata(
    ['Motions, Responses & Replies', 'Motion to file overlength brief'],
    'motion',
    'MOTION_OVERLENGTH',
    { requiresReliefText: true },
  ),
  motion_to_seal: ecfEventMetadata(
    ['Motions, Responses & Replies', 'Motion to seal'],
    'sealed',
    'MOTION_SEAL',
    {
      requiresReliefText: true,
      serviceBehavior: 'manual_required',
      receiptTemplateId: 'sealed_noda',
    },
  ),
  sealed_filing_acknowledgment: ecfEventMetadata(
    ['Forms, Notices & Filing Fees', 'SEALED DOCUMENT (court access only)'],
    'sealed',
    'SEALED_DOCUMENT',
    {
      serviceBehavior: 'manual_required',
      receiptTemplateId: 'sealed_noda',
    },
  ),
  mandate_stay_motion: ecfEventMetadata(
    ['Motions, Responses & Replies', 'Motion to stay mandate'],
    'post_disposition',
    'MANDATE_STAY',
    { requiresReliefText: true, requiresRelatedEntry: true },
  ),
  petition_rehearing: ecfEventMetadata(
    ['Rehearing Petitions & Answers', 'Petition for rehearing by panel or en banc'],
    'post_disposition',
    'REHEARING_PETITION',
  ),
  bill_of_costs: ecfEventMetadata(
    ['Bills of Cost & Objections', 'Bill of Costs'],
    'post_disposition',
    'BILL_COSTS',
  ),
}

const withEcfMetadata = (event: BaseFilingEvent): FilingEvent => ({
  ...event,
  ...(ecfMetadataByEventId[event.id] ??
    ecfEventMetadata(
      ['Other Filings', event.label],
      'motion',
      event.id.toUpperCase(),
    )),
})

const baseFilingEvents: BaseFilingEvent[] = [
  {
    id: 'notice_of_appeal',
    label: 'Notice of Appeal',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('notice_pdf', 'Notice of appeal PDF', 12),
        mustContain: ['notice of appeal'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap3, ruleRefs.frap4, ruleRefs.ca4Local3],
    deadlineEffects: [
      {
        targetEventId: 'appearance_disclosure',
        offsetDays: 14,
        label: 'Appearance and disclosure statement due',
        sourceRuleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
      },
      {
        targetEventId: 'docketing_statement',
        offsetDays: 14,
        label: 'Docketing statement due',
        sourceRuleRefs: [ruleRefs.frap3, ruleRefs.ca4Local3],
      },
      {
        targetEventId: 'transcript_order_acknowledgment',
        offsetDays: 14,
        label: 'Transcript order acknowledgment due',
        sourceRuleRefs: [ruleRefs.frap10, ruleRefs.ca4Local11],
      },
    ],
    docketTextTemplate:
      'Notice of appeal filed by {participant}. Civil appeal opened.',
    possibleClerkResponses: ['Case opened', 'Notice docketed with fee issue'],
  },
  {
    id: 'criminal_notice_of_appeal',
    label: 'Criminal Notice of Appeal',
    domain: 'criminal_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('criminal_notice_pdf', 'Criminal notice of appeal PDF', 12),
        mustContain: ['notice of appeal'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap3, ruleRefs.frap4b],
    deadlineEffects: [
      {
        targetEventId: 'appearance_disclosure',
        offsetDays: 14,
        label: 'Appearance and disclosure statement due',
        sourceRuleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
      },
      {
        targetEventId: 'criminal_docketing_statement',
        offsetDays: 14,
        label: 'Criminal docketing statement due',
        sourceRuleRefs: [ruleRefs.frap3, ruleRefs.ca4Local45],
      },
      {
        targetEventId: 'cja_financial_disclosure',
        offsetDays: 14,
        label: 'CJA financial disclosure due when applicable',
        sourceRuleRefs: [ruleRefs.frap9, ruleRefs.ca4Local9],
      },
    ],
    docketTextTemplate:
      'Criminal notice of appeal filed by {participant}. Criminal appeal opened.',
    possibleClerkResponses: ['Criminal appeal opened', 'CJA or custody issue noted'],
  },
  {
    id: 'petition_for_review',
    label: 'Petition for Review',
    domain: 'agency_review',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('petition_review_pdf', 'Petition for review PDF', 20),
        mustContain: ['petition for review'],
      },
    ],
    optionalDocuments: [pdfRequirement('agency_order_pdf', 'Agency order PDF')],
    validationRuleRefs: [ruleRefs.frap15, ruleRefs.ca4Local15],
    deadlineEffects: [
      {
        targetEventId: 'appearance_disclosure',
        offsetDays: 14,
        label: 'Appearance and disclosure statement due',
        sourceRuleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
      },
      {
        targetEventId: 'agency_docketing_statement',
        offsetDays: 14,
        label: 'Agency-review docketing statement due',
        sourceRuleRefs: [ruleRefs.frap15, ruleRefs.ca4Local15],
      },
      {
        targetEventId: 'certified_agency_record',
        offsetDays: 40,
        label: 'Certified agency record due',
        sourceRuleRefs: [ruleRefs.frap16, ruleRefs.frap17],
      },
    ],
    docketTextTemplate:
      'Petition for review filed by {participant}. Agency-review proceeding opened.',
    possibleClerkResponses: ['Agency review opened', 'Agency record order issued'],
  },
  {
    id: 'petition_for_writ_mandamus',
    label: 'Petition for Writ of Mandamus or Prohibition',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('writ_petition_pdf', 'Writ petition PDF', 30),
        mustContain: ['petition', 'writ'],
      },
    ],
    optionalDocuments: [pdfRequirement('writ_appendix_pdf', 'Writ appendix PDF')],
    validationRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    deadlineEffects: [
      {
        targetEventId: 'appendix_to_writ_petition',
        offsetDays: 0,
        label: 'Appendix or record excerpts due with writ petition',
        sourceRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      },
    ],
    docketTextTemplate:
      'Petition for writ of mandamus or prohibition filed by {participant}: {title}.',
    possibleClerkResponses: ['Petition docketed', 'Petition referred to panel'],
  },
  {
    id: 'appearance_disclosure',
    label: 'Appearance / Disclosure Statement',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('disclosure_pdf', 'Disclosure statement PDF', 20),
        mustContain: ['disclosure'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
    deadlineEffects: [],
    docketTextTemplate: 'Appearance and disclosure statement filed by {participant}.',
    possibleClerkResponses: ['Filed', 'Corporate disclosure deficiency noted'],
  },
  {
    id: 'docketing_statement',
    label: 'Docketing Statement',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('docketing_statement_pdf', 'Docketing statement PDF', 20),
        mustContain: ['docketing statement'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap3, ruleRefs.ca4Local3],
    deadlineEffects: [],
    docketTextTemplate: 'Docketing statement filed by {participant}.',
    possibleClerkResponses: ['Docketing statement filed', 'Jurisdictional issue noted'],
  },
  {
    id: 'criminal_docketing_statement',
    label: 'Criminal Docketing Statement',
    domain: 'criminal_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('criminal_docketing_statement_pdf', 'Criminal docketing statement PDF', 20),
        mustContain: ['docketing statement'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap3, ruleRefs.frap4b, ruleRefs.ca4Local45],
    deadlineEffects: [],
    docketTextTemplate: 'Criminal docketing statement filed by {participant}.',
    possibleClerkResponses: ['Criminal docketing statement filed', 'Custody or CJA issue noted'],
  },
  {
    id: 'agency_docketing_statement',
    label: 'Agency-Review Docketing Statement',
    domain: 'agency_review',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('agency_docketing_statement_pdf', 'Agency-review docketing statement PDF', 20),
        mustContain: ['docketing statement'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap15, ruleRefs.ca4Local15],
    deadlineEffects: [],
    docketTextTemplate: 'Agency-review docketing statement filed by {participant}.',
    possibleClerkResponses: ['Docketing statement filed', 'Agency jurisdiction issue noted'],
  },
  {
    id: 'writ_docketing_statement',
    label: 'Writ Docketing Statement',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('writ_docketing_statement_pdf', 'Writ docketing statement PDF', 20),
        mustContain: ['docketing statement'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    deadlineEffects: [],
    docketTextTemplate: 'Writ docketing statement filed by {participant}.',
    possibleClerkResponses: ['Docketing statement filed', 'Petition referred for screening'],
  },
  {
    id: 'cja_financial_disclosure',
    label: 'CJA Financial Disclosure',
    domain: 'criminal_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('cja_financial_disclosure_pdf', 'CJA financial disclosure PDF', 20),
        mustContain: ['financial'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap9, ruleRefs.ca4Local9],
    deadlineEffects: [],
    docketTextTemplate: 'CJA financial disclosure filed by {participant}.',
    possibleClerkResponses: ['Filed under clerk review', 'Financial disclosure deficiency noted'],
  },
  {
    id: 'transcript_order_acknowledgment',
    label: 'Transcript Order Acknowledgment',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('transcript_ack_pdf', 'Transcript order acknowledgment PDF', 20),
        mustContain: ['transcript'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap10, ruleRefs.ca4Local10, ruleRefs.ca4Local11],
    deadlineEffects: [],
    docketTextTemplate: 'Transcript order acknowledgment filed by {participant}.',
    possibleClerkResponses: ['Transcript order acknowledged', 'Record issue noted'],
  },
  {
    id: 'certified_agency_record',
    label: 'Certified Agency Record',
    domain: 'agency_review',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['agency'],
    requiredDocuments: [
      {
        ...pdfRequirement('agency_record_pdf', 'Certified agency record PDF', 500),
        mustContain: ['record'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap16, ruleRefs.frap17],
    deadlineEffects: [openingBriefDeadline],
    docketTextTemplate: 'Certified agency record filed by {participant}.',
    possibleClerkResponses: ['Agency record filed', 'Record deficiency noted'],
  },
  {
    id: 'motion',
    label: 'Motion',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('motion_pdf', 'Motion PDF', 35),
        mustContain: ['motion'],
      },
    ],
    optionalDocuments: [pdfRequirement('exhibit_pdf', 'Supporting exhibit PDF')],
    validationRuleRefs: [ruleRefs.frap27, ruleRefs.ca4Local27],
    deadlineEffects: [
      {
        targetEventId: 'motion_response',
        offsetDays: 10,
        label: 'Response to motion due',
        sourceRuleRefs: [ruleRefs.frap27],
      },
    ],
    docketTextTemplate: 'Motion filed by {participant}: {title}.',
    possibleClerkResponses: ['Response requested', 'Motion referred to panel'],
  },
  {
    id: 'motion_response',
    label: 'Response to Motion',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('response_pdf', 'Response PDF', 35),
        mustContain: ['response'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap27],
    deadlineEffects: [],
    docketTextTemplate: 'Response filed by {participant}: {title}.',
    possibleClerkResponses: ['Filed', 'Referred to panel with motion'],
  },
  {
    id: 'motion_stay_pending_appeal',
    label: 'Motion to Stay or for Injunction Pending Appeal',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('stay_motion_pdf', 'Stay pending appeal motion PDF', 35),
        mustContain: ['motion', 'stay'],
      },
    ],
    optionalDocuments: [pdfRequirement('district_court_order_pdf', 'District-court stay order PDF')],
    validationRuleRefs: [ruleRefs.frap8, ruleRefs.frap27, ruleRefs.ca4Local8, ruleRefs.ca4Local27],
    deadlineEffects: [
      {
        targetEventId: 'motion_response',
        offsetDays: 7,
        label: 'Response to stay motion due',
        sourceRuleRefs: [ruleRefs.frap8, ruleRefs.frap27, ruleRefs.ca4Local27],
      },
    ],
    docketTextTemplate: 'Motion to stay or for injunction pending appeal filed by {participant}: {title}.',
    possibleClerkResponses: ['Emergency motion referred to panel', 'Response requested'],
  },
  {
    id: 'motion_to_supplement_record',
    label: 'Motion to Supplement Record',
    domain: 'agency_review',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'agency'],
    requiredDocuments: [
      {
        ...pdfRequirement('supplement_record_motion_pdf', 'Motion to supplement record PDF', 35),
        mustContain: ['motion', 'record'],
      },
    ],
    optionalDocuments: [pdfRequirement('proposed_record_material_pdf', 'Proposed record material PDF')],
    validationRuleRefs: [ruleRefs.frap16, ruleRefs.frap17, ruleRefs.frap27],
    deadlineEffects: [
      {
        targetEventId: 'motion_response',
        offsetDays: 10,
        label: 'Response to record motion due',
        sourceRuleRefs: [ruleRefs.frap27],
      },
    ],
    docketTextTemplate: 'Motion to supplement the record filed by {participant}: {title}.',
    possibleClerkResponses: ['Response requested', 'Motion referred to panel with agency record'],
  },
  {
    id: 'emergency_motion_stay',
    label: 'Emergency Motion for Stay',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('emergency_stay_motion_pdf', 'Emergency stay motion PDF', 35),
        mustContain: ['motion', 'stay'],
      },
    ],
    optionalDocuments: [pdfRequirement('challenged_order_pdf', 'Challenged order PDF')],
    validationRuleRefs: [ruleRefs.frap18, ruleRefs.frap21, ruleRefs.ca4Local18, ruleRefs.ca4Local21],
    deadlineEffects: [
      {
        targetEventId: 'answer_to_writ_petition',
        offsetDays: 7,
        label: 'Answer to writ petition due if ordered',
        sourceRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      },
    ],
    docketTextTemplate: 'Emergency motion for stay filed by {participant}: {title}.',
    possibleClerkResponses: ['Emergency motion referred to panel', 'Answer requested'],
  },
  {
    id: 'appendix_to_writ_petition',
    label: 'Appendix to Writ Petition',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('writ_appendix_pdf', 'Writ appendix PDF', 300),
        mustContain: ['appendix'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    deadlineEffects: [],
    docketTextTemplate: 'Appendix to writ petition filed by {participant}.',
    possibleClerkResponses: ['Appendix accepted', 'Record excerpts deficiency noted'],
  },
  {
    id: 'order_inviting_answer',
    label: 'Order Inviting Answer',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['clerk', 'panel'],
    requiredDocuments: [
      {
        ...pdfRequirement('answer_order_pdf', 'Order inviting answer PDF', 10),
        mustContain: ['answer'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    deadlineEffects: [
      {
        targetEventId: 'answer_to_writ_petition',
        offsetDays: 14,
        label: 'Answer to writ petition due',
        sourceRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      },
    ],
    docketTextTemplate: 'Order inviting answer entered by {participant}.',
    possibleClerkResponses: ['Answer deadline set', 'Order served on parties'],
  },
  {
    id: 'answer_to_writ_petition',
    label: 'Answer to Writ Petition',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellee', 'district_court'],
    requiredDocuments: [
      {
        ...pdfRequirement('writ_answer_pdf', 'Answer to writ petition PDF', 50),
        mustContain: ['answer'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    deadlineEffects: [
      {
        targetEventId: 'reply_in_support_of_writ',
        offsetDays: 7,
        label: 'Reply in support of writ due if permitted',
        sourceRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      },
    ],
    docketTextTemplate: 'Answer to writ petition filed by {participant}.',
    possibleClerkResponses: ['Answer accepted', 'Petition package referred to panel'],
  },
  {
    id: 'reply_in_support_of_writ',
    label: 'Reply in Support of Writ Petition',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('writ_reply_pdf', 'Reply in support of writ PDF', 25),
        mustContain: ['reply'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    deadlineEffects: [],
    docketTextTemplate: 'Reply in support of writ petition filed by {participant}.',
    possibleClerkResponses: ['Reply accepted', 'Petition ready for panel disposition'],
  },
  {
    id: 'writ_disposition',
    label: 'Writ Disposition',
    domain: 'original_writ',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['panel'],
    requiredDocuments: [
      {
        ...pdfRequirement('writ_disposition_pdf', 'Writ disposition PDF', 20),
        mustContain: ['petition'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    deadlineEffects: [],
    docketTextTemplate: 'Writ disposition entered by {participant}.',
    possibleClerkResponses: ['Disposition entered', 'Mandamus petition closed'],
  },
  {
    id: 'opening_brief',
    label: 'Opening Brief',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('brief_pdf', 'Opening brief PDF', 80),
        mustContain: ['statement of issues', 'standard of review'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [
      ruleRefs.frap28,
      ruleRefs.frap31,
      ruleRefs.frap32,
      ruleRefs.ca4Local28,
      ruleRefs.ca4Local32,
    ],
    deadlineEffects: [appelleeBriefDeadline],
    docketTextTemplate: 'Opening brief filed by {participant}.',
    possibleClerkResponses: ['Brief accepted', 'Deficiency notice issued'],
  },
  {
    id: 'joint_appendix',
    label: 'Joint Appendix',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('appendix_pdf', 'Joint appendix PDF', 500),
        mustContain: ['appendix'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    deadlineEffects: [],
    docketTextTemplate: 'Joint appendix filed by {participant}.',
    possibleClerkResponses: ['Appendix accepted', 'Appendix deficiency noted'],
  },
  {
    id: 'appellee_brief',
    label: 'Appellee Brief',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('brief_pdf', 'Appellee brief PDF', 80),
        mustContain: ['argument'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap28, ruleRefs.frap31, ruleRefs.frap32, ruleRefs.ca4Local32],
    deadlineEffects: [replyBriefDeadline],
    docketTextTemplate: 'Appellee brief filed by {participant}.',
    possibleClerkResponses: ['Brief accepted', 'Deficiency notice issued'],
  },
  {
    id: 'reply_brief',
    label: 'Reply Brief',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant'],
    requiredDocuments: [
      {
        ...pdfRequirement('reply_pdf', 'Reply brief PDF', 40),
        mustContain: ['reply'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap28, ruleRefs.frap31, ruleRefs.frap32, ruleRefs.ca4Local32],
    deadlineEffects: [],
    docketTextTemplate: 'Reply brief filed by {participant}.',
    possibleClerkResponses: ['Brief accepted', 'Submitted to panel'],
  },
  {
    id: 'amicus_notice_or_consent',
    label: 'Amicus Notice / Consent Statement',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('amicus_consent_pdf', 'Amicus consent or notice PDF', 20),
        mustContain: ['amicus'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap29],
    deadlineEffects: [],
    docketTextTemplate: 'Amicus notice or consent statement filed by {participant}.',
    possibleClerkResponses: ['Consent noted', 'Leave required'],
  },
  {
    id: 'motion_for_leave_to_file_amicus',
    label: 'Motion for Leave to File Amicus Brief',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('amicus_leave_pdf', 'Motion for leave PDF', 35),
        mustContain: ['motion', 'amicus'],
      },
    ],
    optionalDocuments: [pdfRequirement('proposed_amicus_pdf', 'Proposed amicus brief PDF', 40)],
    validationRuleRefs: [ruleRefs.frap29],
    deadlineEffects: [
      {
        targetEventId: 'response_to_amicus_motion',
        offsetDays: 7,
        label: 'Response to amicus motion due',
        sourceRuleRefs: [ruleRefs.frap29],
      },
    ],
    docketTextTemplate: 'Motion for leave to file amicus brief tendered by {participant}.',
    possibleClerkResponses: ['Motion referred to panel', 'Response requested'],
  },
  {
    id: 'response_to_amicus_motion',
    label: 'Response to Amicus Motion',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('amicus_response_pdf', 'Response to amicus motion PDF', 30),
        mustContain: ['response'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap29],
    deadlineEffects: [],
    docketTextTemplate: 'Response to amicus motion filed by {participant}.',
    possibleClerkResponses: ['Filed', 'Referred to panel'],
  },
  {
    id: 'amicus_brief',
    label: 'Amicus Brief',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('amicus_pdf', 'Amicus brief PDF', 40),
        mustContain: ['amicus'],
      },
    ],
    optionalDocuments: [pdfRequirement('motion_leave_pdf', 'Motion for leave PDF')],
    validationRuleRefs: [ruleRefs.frap29],
    deadlineEffects: [],
    docketTextTemplate: 'Amicus brief tendered by {participant}.',
    possibleClerkResponses: ['Accepted by consent', 'Leave required'],
  },
  {
    id: 'corrected_brief',
    label: 'Corrected Brief',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('corrected_brief_pdf', 'Corrected brief PDF', 80),
        mustContain: ['argument'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap28, ruleRefs.frap32, ruleRefs.ca4Local28, ruleRefs.ca4Local32],
    deadlineEffects: [],
    docketTextTemplate: 'Corrected brief filed by {participant}: {title}.',
    possibleClerkResponses: ['Deficiency cured', 'Further deficiency noted'],
  },
  {
    id: 'rule_28j_letter',
    label: 'Rule 28(j) Letter',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('rule_28j_pdf', 'Rule 28(j) letter PDF', 8),
        mustContain: ['28(j)'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap28, ruleRefs.ca4Local28],
    deadlineEffects: [],
    docketTextTemplate: 'Rule 28(j) letter filed by {participant}.',
    possibleClerkResponses: ['Filed', 'Returned if post-judgment'],
  },
  {
    id: 'motion_extend_time',
    label: 'Motion to Extend Time',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('extension_motion_pdf', 'Extension motion PDF', 35),
        mustContain: ['motion'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap26, ruleRefs.frap27, ruleRefs.ca4Local27],
    deadlineEffects: [
      {
        targetEventId: 'motion_response',
        offsetDays: 10,
        label: 'Response to extension motion due',
        sourceRuleRefs: [ruleRefs.frap27],
      },
    ],
    docketTextTemplate: 'Motion to extend time filed by {participant}: {title}.',
    possibleClerkResponses: ['Response requested', 'Routine extension granted'],
  },
  {
    id: 'motion_overlength_brief',
    label: 'Motion to File Overlength Brief',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('overlength_motion_pdf', 'Overlength motion PDF', 35),
        mustContain: ['motion'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap27, ruleRefs.frap32, ruleRefs.ca4Local32],
    deadlineEffects: [
      {
        targetEventId: 'motion_response',
        offsetDays: 10,
        label: 'Response to overlength motion due',
        sourceRuleRefs: [ruleRefs.frap27],
      },
    ],
    docketTextTemplate: 'Motion to file overlength brief filed by {participant}: {title}.',
    possibleClerkResponses: ['Motion referred to panel', 'Response requested'],
  },
  {
    id: 'motion_to_seal',
    label: 'Motion to Seal',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('seal_motion_pdf', 'Motion to seal PDF', 35),
        mustContain: ['motion', 'seal'],
      },
    ],
    optionalDocuments: [pdfRequirement('sealed_material_pdf', 'Proposed sealed material PDF')],
    validationRuleRefs: [ruleRefs.frap25, ruleRefs.frap27, ruleRefs.ca4Local25, ruleRefs.ca4Local27],
    deadlineEffects: [
      {
        targetEventId: 'sealed_filing_acknowledgment',
        offsetDays: 0,
        label: 'Sealed filing acknowledgement due',
        sourceRuleRefs: [ruleRefs.frap25, ruleRefs.ca4Local25],
      },
    ],
    docketTextTemplate: 'Motion to seal filed by {participant}: {title}.',
    possibleClerkResponses: ['Sealed material lodged', 'Public redacted copy required'],
  },
  {
    id: 'sealed_filing_acknowledgment',
    label: 'Sealed Filing Acknowledgment',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee', 'amicus'],
    requiredDocuments: [
      {
        ...pdfRequirement('sealed_ack_pdf', 'Sealed filing acknowledgment PDF', 10),
        mustContain: ['sealed'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap25, ruleRefs.ca4Local25],
    deadlineEffects: [],
    docketTextTemplate: 'Sealed filing acknowledgement filed by {participant}.',
    possibleClerkResponses: ['Acknowledgement accepted', 'Redaction issue noted'],
  },
  {
    id: 'mandate_stay_motion',
    label: 'Motion to Stay Mandate',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('mandate_stay_pdf', 'Motion to stay mandate PDF', 30),
        mustContain: ['motion', 'mandate'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap27, ruleRefs.frap41, ruleRefs.ca4Local41],
    deadlineEffects: [],
    docketTextTemplate: 'Motion to stay mandate filed by {participant}: {title}.',
    possibleClerkResponses: ['Referred to panel', 'Response requested'],
  },
  {
    id: 'petition_rehearing',
    label: 'Panel or En Banc Rehearing Petition',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('rehearing_pdf', 'Rehearing petition PDF', 30),
        mustContain: ['rehearing'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap40, ruleRefs.ca4Local40],
    deadlineEffects: [],
    docketTextTemplate: 'Petition for rehearing filed by {participant}.',
    possibleClerkResponses: ['Distributed to panel', 'Denied as untimely'],
  },
  {
    id: 'bill_of_costs',
    label: 'Bill of Costs',
    domain: 'civil_appeal',
    allowedCourtLevels: ['intermediate_appellate'],
    allowedParticipantRoles: ['appellant', 'appellee'],
    requiredDocuments: [
      {
        ...pdfRequirement('costs_pdf', 'Bill of costs PDF', 20),
        mustContain: ['costs'],
      },
    ],
    optionalDocuments: [],
    validationRuleRefs: [ruleRefs.frap39, ruleRefs.ca4Local39],
    deadlineEffects: [],
    docketTextTemplate: 'Bill of costs filed by {participant}.',
    possibleClerkResponses: ['Costs taxed if timely', 'Returned if premature'],
  },
]

export const filingEvents: FilingEvent[] = baseFilingEvents.map(withEcfMetadata)

const commonAppealEventIds = new Set([
  'appearance_disclosure',
  'transcript_order_acknowledgment',
  'opening_brief',
  'joint_appendix',
  'appellee_brief',
  'reply_brief',
  'motion',
  'motion_response',
  'motion_extend_time',
  'motion_overlength_brief',
  'motion_to_seal',
  'sealed_filing_acknowledgment',
  'corrected_brief',
  'rule_28j_letter',
  'petition_rehearing',
  'mandate_stay_motion',
  'bill_of_costs',
])

const commonAgencyEventIds = new Set([
  'appearance_disclosure',
  'opening_brief',
  'joint_appendix',
  'appellee_brief',
  'reply_brief',
  'motion',
  'motion_response',
  'motion_extend_time',
  'motion_overlength_brief',
  'motion_to_seal',
  'sealed_filing_acknowledgment',
  'corrected_brief',
  'rule_28j_letter',
  'petition_rehearing',
  'mandate_stay_motion',
  'bill_of_costs',
])

const civilFilingEvents = filingEvents.filter((event) => event.domain === 'civil_appeal')
const criminalFilingEvents = filingEvents.filter(
  (event) => event.domain === 'criminal_appeal' || commonAppealEventIds.has(event.id),
).map((event) => {
  if (event.id === 'opening_brief') {
    return { ...event, deadlineEffects: [criminalAppelleeBriefDeadline] }
  }
  if (event.id === 'appellee_brief') {
    return { ...event, deadlineEffects: [criminalReplyBriefDeadline] }
  }
  return event
})
const agencyReviewFilingEvents = filingEvents.filter(
  (event) => event.domain === 'agency_review' || commonAgencyEventIds.has(event.id),
)
const originalWritFilingEvents = filingEvents.filter(
  (event) =>
    event.domain === 'original_writ' ||
    ['appearance_disclosure', 'motion', 'motion_response', 'motion_to_seal', 'sealed_filing_acknowledgment'].includes(event.id),
)

const frapItems: RuleItem[] = [
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_3',
    topic: 'notice_of_appeal',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'An appeal as of right is taken by filing a notice of appeal.',
    structuredConstraints: [
      { kind: 'required_document', value: 'notice_of_appeal' },
      { kind: 'event_sequence', value: 'opens civil appeal' },
    ],
    simulatorNotes:
      'The simulator treats the notice as the jurisdiction-opening filing.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_4_A_1',
    topic: 'deadline',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText:
      'Civil notices of appeal are generally due within the rule-defined appeal period.',
    structuredConstraints: [
      { kind: 'deadline', value: 'civil notice of appeal deadline' },
    ],
    simulatorNotes:
      'The MVP gives example deadline pressure without real waiting or live legal advice.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_4_B',
    topic: 'criminal_notice_deadline',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule4Source,
    plainText:
      'Criminal notices of appeal use the criminal appeal timing path, including shorter defendant-notice timing and government-notice timing.',
    structuredConstraints: [
      { kind: 'deadline', value: 'criminal notice of appeal deadline' },
      { kind: 'event_sequence', value: 'opens criminal appeal' },
    ],
    simulatorNotes:
      'The simulator models defendant criminal notices with a shorter training deadline and flags late-notice posture for instructor review.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_8',
    topic: 'stay_pending_appeal',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText:
      'Stay or injunction pending appeal practice requires a motion and district-court-first information unless impracticable.',
    structuredConstraints: [
      { kind: 'required_document', value: 'stay or injunction pending appeal motion' },
      { kind: 'event_sequence', value: 'district-court-first signal' },
    ],
    simulatorNotes:
      'The validator warns when emergency stay papers omit district-court-first information.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_9',
    topic: 'criminal_release',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule9Source,
    plainText:
      'Release or detention review in a criminal case requires the district-court order, reasons, and any transcript or explanation needed for factual challenges.',
    structuredConstraints: [
      { kind: 'required_document', value: 'release order and reasons' },
      { kind: 'event_sequence', value: 'prompt criminal release review' },
    ],
    simulatorNotes:
      'Release-related filings can be referred promptly and do not follow ordinary merits briefing cadence.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_10',
    topic: 'record_on_appeal',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'The record on appeal defines the materials transmitted for review.',
    structuredConstraints: [
      { kind: 'required_document', value: 'record and transcript materials' },
    ],
    simulatorNotes:
      'Record disputes and appendix issues are modeled as clerk or panel events.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_15',
    topic: 'agency_petition_review',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule15Source,
    plainText:
      'Agency review is commenced by petition for review or enforcement papers that identify the parties, agency, and order under review.',
    structuredConstraints: [
      { kind: 'required_document', value: 'petition for review' },
      { kind: 'service', value: 'agency proceeding parties' },
      { kind: 'fee_or_ifp', value: 'petition filing fee or IFP signal' },
    ],
    simulatorNotes:
      'Agency-review validation checks petition naming, agency order identification, service, and fee or IFP posture.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_16',
    topic: 'agency_record',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule16Source,
    plainText:
      'Agency-review records include the order, findings, report, pleadings, evidence, and other proceedings materials, with correction available for omissions or misstatements.',
    structuredConstraints: [
      { kind: 'required_document', value: 'agency record or certified list' },
      { kind: 'event_sequence', value: 'supplemental record correction' },
    ],
    simulatorNotes:
      'Record defects create a supplement-record branch rather than automatically blocking merits briefing.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_17',
    topic: 'agency_record_filing',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule17Source,
    plainText:
      'The agency files the record or a certified list, and record filing triggers the clerk notice and briefing schedule path.',
    structuredConstraints: [
      { kind: 'deadline', value: 'agency record due' },
      { kind: 'event_sequence', value: 'clerk record notice' },
    ],
    simulatorNotes:
      'Filing the certified agency record opens Local Rule 31 briefing in agency-review scenarios.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_18',
    topic: 'agency_stay_pending_review',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule18Source,
    plainText:
      'Stay pending agency review ordinarily requires agency-first relief or a showing that seeking agency relief first was impracticable.',
    structuredConstraints: [
      { kind: 'required_document', value: 'stay pending review motion' },
      { kind: 'event_sequence', value: 'agency-first stay signal' },
    ],
    simulatorNotes:
      'The validator warns when agency-review stay papers omit agency-first denial, inaction, or impracticability.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_19',
    topic: 'agency_partial_enforcement_judgment',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule19Source,
    plainText:
      'After an opinion enforcing an agency order in part, proposed conforming judgment practice may be required.',
    structuredConstraints: [
      { kind: 'deadline', value: 'proposed agency judgment' },
      { kind: 'event_sequence', value: 'court settles judgment' },
    ],
    simulatorNotes:
      'FRAP 19 events unlock only after a panel disposition enforcing an agency order in part.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_20',
    topic: 'agency_rule_applicability',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule20Source,
    plainText:
      'Agency-review proceedings use appellate-rule role mappings, including petitioner/applicant as appellant and respondent as appellee.',
    structuredConstraints: [
      { kind: 'event_sequence', value: 'agency role mapping' },
    ],
    simulatorNotes:
      'This supports using appellant/appellee role labels in agency-review training while preserving agency-specific filing events.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_21',
    topic: 'original_writ',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: ca4Rule21Source,
    plainText:
      'Mandamus, prohibition, and other extraordinary writ petitions are filed in the court of appeals with required content, service, and essential record materials.',
    structuredConstraints: [
      { kind: 'required_document', value: 'original writ petition' },
      { kind: 'service', value: 'trial-court parties and judge copy' },
      { kind: 'fee_or_ifp', value: 'writ docket fee or IFP signal' },
    ],
    simulatorNotes:
      'The clerk may submit the petition to the panel, note fee or service defects, or set an answer deadline if the panel invites an answer.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_25',
    topic: 'filing_service',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Filing and service rules control how papers are submitted and served.',
    structuredConstraints: [
      { kind: 'service', value: 'filing and service requirements' },
    ],
    simulatorNotes:
      'Missing service certificates can trigger filing warnings or deficiency notices.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_26',
    topic: 'time_computation',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Time-computation rules govern deadlines and extensions.',
    structuredConstraints: [{ kind: 'deadline', value: 'time computation' }],
    simulatorNotes:
      'The simulator uses calendar-day offsets for training deadlines.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_26_1',
    topic: 'disclosure',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Certain parties must file disclosure statements.',
    structuredConstraints: [{ kind: 'certificate', value: 'disclosure statement' }],
    simulatorNotes:
      'Corporate disclosure and appearance failures trigger clerk deficiency events.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_27',
    topic: 'motions',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Motions must state with particularity the grounds and relief sought.',
    structuredConstraints: [
      { kind: 'required_document', value: 'motion' },
      { kind: 'service', value: 'service required' },
    ],
    simulatorNotes:
      'Motions can request responses, be referred to a panel, or be denied by order.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_28',
    topic: 'briefs',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Briefs must contain required appellate sections.',
    structuredConstraints: [
      { kind: 'required_document', value: 'brief' },
      { kind: 'certificate', value: 'required sections' },
    ],
    simulatorNotes:
      'The validator checks for high-signal filing defects, not perfect legal writing.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_29',
    topic: 'amicus',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Amicus participation is governed by rule and may require leave or consent.',
    structuredConstraints: [
      { kind: 'required_document', value: 'amicus brief or motion for leave' },
    ],
    simulatorNotes:
      'Amicus filings can be accepted, held for leave, or denied by the panel.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_30',
    topic: 'appendix',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Appendix rules govern materials submitted with merits briefing.',
    structuredConstraints: [
      { kind: 'required_document', value: 'appendix materials' },
    ],
    simulatorNotes:
      'The opening brief path expects a joint appendix or a clerk deficiency.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_31',
    topic: 'briefing_deadlines',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Briefing proceeds in ordered stages after the record is ready.',
    structuredConstraints: [
      { kind: 'deadline', value: 'opening/appellee/reply briefing sequence' },
    ],
    simulatorNotes: 'The simulator computes example due dates and allows manual advance.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_32',
    topic: 'form',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Form rules govern briefs, appendices, and other appellate papers.',
    structuredConstraints: [
      { kind: 'certificate', value: 'form and type-volume compliance' },
    ],
    simulatorNotes:
      'Brief filing validation treats missing compliance certificates as warnings.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_34',
    topic: 'oral_argument',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Oral argument may be set or dispensed with under appellate rules.',
    structuredConstraints: [
      { kind: 'event_sequence', value: 'panel submission and argument' },
    ],
    simulatorNotes:
      'Panel submission and optional argument are modeled after briefing is complete.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_36',
    topic: 'judgment',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Judgment entry and notice are handled under appellate rules.',
    structuredConstraints: [{ kind: 'event_sequence', value: 'judgment entry' }],
    simulatorNotes:
      'Panel dispositions create docket entries and unlock post-judgment practice.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_39',
    topic: 'costs',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Costs are handled after judgment under appellate cost rules.',
    structuredConstraints: [{ kind: 'event_sequence', value: 'post-judgment bill of costs' }],
    simulatorNotes:
      'Bills of costs are rejected as premature before judgment is entered.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_40',
    topic: 'rehearing',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Panel rehearing and en banc rehearing are governed by rule.',
    structuredConstraints: [{ kind: 'deadline', value: 'rehearing petition window' }],
    simulatorNotes:
      'Post-disposition filings unlock only after judgment or panel order.',
  },
  {
    jurisdiction: 'us-federal',
    ruleId: 'FRAP_41',
    topic: 'mandate',
    effectiveFrom: '2025-12-01',
    sourceLabel: 'Federal Rules of Appellate Procedure',
    sourceUrl: usCourtsFrapSource,
    plainText: 'Mandate rules govern issuance and stays after appellate judgment.',
    structuredConstraints: [{ kind: 'deadline', value: 'mandate issuance' }],
    simulatorNotes:
      'Mandate-related consequences can be added after rehearing practice.',
  },
]

const ca4Items: RuleItem[] = [
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_ECF_EVENTS',
    topic: 'ecf_event_menu',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Filing Events & Reliefs',
    sourceUrl: ca4EcfEventsSource,
    plainText:
      'Fourth Circuit CM/ECF publishes event categories for forms, motions, briefing documents, argument notices, judgments, rehearing, bills of cost, and other filings.',
    structuredConstraints: [
      { kind: 'event_sequence', value: 'court-specific CM/ECF event menu' },
      { kind: 'attachment_type', value: 'event-specific document assembly' },
    ],
    simulatorNotes:
      'The CM/ECF wizard uses these public event categories for menu paths and receipt labels.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_3',
    topic: 'notice_and_docketing_statement',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Fourth Circuit local practice includes filing fees and docketing statement requirements for new appeals.',
    structuredConstraints: [
      { kind: 'required_document', value: 'docketing statement' },
      { kind: 'fee_or_ifp', value: 'filing or docketing fee signal' },
    ],
    simulatorNotes:
      'After a notice of appeal, the simulator expects a docketing statement before merits scheduling.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_8',
    topic: 'stay_pending_appeal',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Fourth Circuit local stay practice supplements federal stay and emergency motion practice.',
    structuredConstraints: [
      { kind: 'event_sequence', value: 'stay motion and emergency handling' },
    ],
    simulatorNotes:
      'Stay motions can trigger expedited response deadlines and panel referral.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_9',
    topic: 'criminal_release_local_handling',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4Rule9Source,
    plainText:
      'Fourth Circuit local release practice supports prompt consideration of criminal release appeals and motions on submitted materials.',
    structuredConstraints: [
      { kind: 'event_sequence', value: 'prompt criminal release review' },
    ],
    simulatorNotes:
      'Release papers with missing district-court reasons or transcript signals receive a cure warning.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_10',
    topic: 'record_on_appeal',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local record rules govern record retention, transcripts, and supplemental record handling.',
    structuredConstraints: [
      { kind: 'required_document', value: 'record and transcript materials' },
    ],
    simulatorNotes:
      'Record defects are modeled as warnings, deficiency notices, and limited panel relief.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_11',
    topic: 'transcript_acknowledgment',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local forwarding-record practice includes transcript acknowledgments and transcript timing.',
    structuredConstraints: [
      { kind: 'required_document', value: 'transcript order acknowledgment' },
    ],
    simulatorNotes:
      'The opening stage expects transcript order acknowledgment before briefing is scheduled.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_15',
    topic: 'agency_petitions',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4Rule15Source,
    plainText:
      'Fourth Circuit agency-review practice supplements petition-for-review filing, docketing fee, and petition handling.',
    structuredConstraints: [
      { kind: 'required_document', value: 'agency petition and order' },
      { kind: 'fee_or_ifp', value: 'agency-review docketing fee' },
    ],
    simulatorNotes:
      'Agency petitions missing party naming, order identification, service, or fee posture are returned with source-backed cure text.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_18',
    topic: 'agency_stay_pending_review',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4Rule18Source,
    plainText:
      'Fourth Circuit local stay procedures supplement stay pending review motion practice.',
    structuredConstraints: [
      { kind: 'event_sequence', value: 'agency stay motion and emergency handling' },
    ],
    simulatorNotes:
      'Agency-review stay motions can trigger expedited response deadlines and panel referral.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_21',
    topic: 'original_writ_local_handling',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4Rule21Source,
    plainText:
      'Fourth Circuit local writ practice supplements FRAP 21 case captions, petition handling, fee, IFP, and prisoner petition requirements.',
    structuredConstraints: [
      { kind: 'required_document', value: 'writ petition and essential record appendix' },
      { kind: 'fee_or_ifp', value: 'writ docket fee or IFP papers' },
      { kind: 'event_sequence', value: 'panel submission of writ petition' },
    ],
    simulatorNotes:
      'Writ petitions are checked for caption, service, fee or IFP posture, disclosure, and essential order or record attachments.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_12',
    topic: 'appearance_disclosure',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText:
      'Fourth Circuit practice includes local appearance and disclosure conventions.',
    structuredConstraints: [
      { kind: 'required_document', value: 'appearance/disclosure' },
    ],
    simulatorNotes:
      'The court pack can issue a deficiency if the early appearance/disclosure step is skipped.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_25',
    topic: 'filing_service_sealed_materials',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local filing and service rules include CM/ECF practice and sealed or confidential materials handling.',
    structuredConstraints: [
      { kind: 'service', value: 'electronic filing and service' },
      { kind: 'sealed_filing', value: 'sealed and confidential material handling' },
      { kind: 'privacy_redaction', value: 'redaction acknowledgement' },
    ],
    simulatorNotes:
      'Sealed filings without redaction acknowledgement are rejected by preflight.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_26_1',
    topic: 'disclosure',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local disclosure statement practice supplements federal disclosure requirements.',
    structuredConstraints: [{ kind: 'certificate', value: 'disclosure statement' }],
    simulatorNotes:
      'Disclosure sequencing is checked before opening-brief scheduling.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_27',
    topic: 'motions',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local motion practice can alter clerk handling and panel referral.',
    structuredConstraints: [{ kind: 'event_sequence', value: 'motion response path' }],
    simulatorNotes:
      'The clerk can ask for a response or refer motion papers to the panel.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_28',
    topic: 'briefs',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Fourth Circuit local briefing rules supplement federal brief requirements.',
    structuredConstraints: [
      { kind: 'required_document', value: 'local brief requirements' },
    ],
    simulatorNotes:
      'Local brief defects are modeled as clerk deficiency notices or warnings.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_30',
    topic: 'appendix',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Appendix practice is governed by federal and local appellate rules.',
    structuredConstraints: [{ kind: 'required_document', value: 'joint appendix' }],
    simulatorNotes:
      'Opening brief without appendix can be accepted with a deficiency or held.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_31',
    topic: 'briefing_deadlines',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4LocalRule31Source,
    plainText:
      'A formal briefing schedule is sent when the record is received or the clerk determines the record is complete, whichever occurs first; the briefing order controls brief and joint appendix timing.',
    structuredConstraints: [
      { kind: 'deadline', value: 'local briefing schedule handling' },
      { kind: 'event_sequence', value: 'briefing schedule after record completion' },
    ],
    simulatorNotes:
      'The simulator issues the opening-brief schedule only after docketing and transcript/record-ordering prerequisites are complete or clerk-determined complete.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_32',
    topic: 'form_and_length',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local form rules supplement federal form, appendix reproduction, length, and correction rules.',
    structuredConstraints: [
      { kind: 'word_limit', value: 'brief type-volume and overlength handling' },
      { kind: 'attachment_type', value: 'corrected briefs and appendices' },
    ],
    simulatorNotes:
      'The validator warns about potentially overlength briefs and requires compliance certificates.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_34',
    topic: 'oral_argument',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local oral argument practice includes statements regarding the need for oral argument.',
    structuredConstraints: [{ kind: 'brief_content_section', value: 'oral argument statement' }],
    simulatorNotes:
      'Merits briefs without an oral-argument signal receive a training warning.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_39',
    topic: 'costs',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local cost rules govern reproduction costs, bills of costs, and district-court cost recovery.',
    structuredConstraints: [{ kind: 'event_sequence', value: 'bill of costs after judgment' }],
    simulatorNotes:
      'Bill-of-costs filings are available only after judgment in the simulator.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_40',
    topic: 'rehearing',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local rehearing rules govern filing, purpose, timing, and post-denial papers.',
    structuredConstraints: [{ kind: 'deadline', value: 'post-judgment rehearing petition' }],
    simulatorNotes:
      'Rehearing petitions are rejected before judgment and create post-judgment workflow after judgment.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_41',
    topic: 'mandate',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Local mandate practice supplements federal mandate issuance and stay rules.',
    structuredConstraints: [{ kind: 'deadline', value: 'mandate issuance and stay' }],
    simulatorNotes:
      'Mandate stays are post-judgment events and must cite mandate authority.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_45',
    topic: 'clerk_authority',
    effectiveFrom: '2026-03-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'The clerk handles routine procedural matters under local practice.',
    structuredConstraints: [{ kind: 'event_sequence', value: 'clerk deficiency order' }],
    simulatorNotes:
      'This enables realistic clerk notices without using free-form AI as authority.',
  },
]

export const rulePacks: RulePack[] = [
  {
    id: 'procedure-core',
    moduleId: 'procedure-core',
    label: 'Generic Procedure Core',
    courtSystem: 'federal',
    version: '0.1.0',
    sourceUrl: 'internal://procedure-core',
    sourceVersionIds: ['procedure-core:0.1.0'],
    items: [],
  },
  {
    id: 'civil-appeal',
    moduleId: 'civil-appeal',
    label: 'Civil Appeal Procedure Pack',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'civil_appeal',
    version: '0.1.0',
    sourceUrl: 'internal://civil-appeal',
    sourceVersionIds: ['civil-appeal:0.1.0'],
    items: [],
  },
  {
    id: 'criminal-appeal',
    moduleId: 'criminal-appeal',
    label: 'Criminal Appeal Procedure Pack',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'criminal_appeal',
    version: '0.1.0',
    sourceUrl: 'internal://criminal-appeal',
    sourceVersionIds: ['criminal-appeal:0.1.0'],
    items: [],
  },
  {
    id: 'agency-review',
    moduleId: 'agency-review',
    label: 'Agency Review Procedure Pack',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'agency_review',
    version: '0.1.0',
    sourceUrl: 'internal://agency-review',
    sourceVersionIds: ['agency-review:0.1.0'],
    items: [],
  },
  {
    id: 'original-writ',
    moduleId: 'original-writ',
    label: 'Original Writ Procedure Pack',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'original_writ',
    version: '0.1.0',
    sourceUrl: 'internal://original-writ',
    sourceVersionIds: ['original-writ:0.1.0'],
    items: [],
  },
  {
    id: 'frap-2025',
    moduleId: 'frap-2025',
    label: 'Federal Rules of Appellate Procedure',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'civil_appeal',
    version: '2025-12-01',
    sourceUrl: usCourtsFrapSource,
    sourceVersionIds: ['frap-2025:2025-12-01'],
    items: frapItems,
  },
  {
    id: 'ca4-current',
    moduleId: 'ca4-current',
    label: 'Fourth Circuit Local Rules and IOPs',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'civil_appeal',
    version: '2026-03-23',
    sourceUrl: ca4RulesAndProceduresSource,
    sourceVersionIds: ['ca4-current:2026-03-23'],
    items: ca4Items,
  },
]

const aiActors: AiActor[] = [
  {
    id: 'ca4_clerk',
    label: 'Clerk',
    role: 'clerk',
    authorityScope: ['deficiency notices', 'routine orders', 'briefing schedule'],
    allowedTools: [
      'issueClerkOrder',
      'setDeadline',
      'submitToPanel',
      'recommendClerkAction',
      'draftClerkOrder',
    ],
  },
  {
    id: 'appellee_ai',
    label: 'AI Counterparty',
    role: 'opposing_party',
    authorityScope: ['responses', 'motions', 'appellee brief'],
    allowedTools: [
      'fileCounterpartyDocument',
      'draftCounterpartyFiling',
      'analyzeAppellantFiling',
      'draftCounterpartyStrategy',
      'fileResponsiveMotion',
      'fileAppelleeBrief',
      'opposeMotion',
      'respondToRehearing',
    ],
  },
  {
    id: 'ca4_staff_attorney',
    label: 'Staff Attorney',
    role: 'judge',
    authorityScope: ['screening memos', 'procedural recommendations'],
    allowedTools: [
      'draftBenchMemo',
      'draftStaffMemo',
      'recommendClerkAction',
      'draftAssessmentFeedback',
    ],
  },
  {
    id: 'ca4_judge_1',
    label: 'Panel Judge 1',
    role: 'judge',
    authorityScope: ['panel vote', 'bench memo review'],
    allowedTools: ['castPanelVote', 'castRuntimePanelVote', 'draftBenchMemo'],
  },
  {
    id: 'ca4_judge_2',
    label: 'Panel Judge 2',
    role: 'judge',
    authorityScope: ['panel vote', 'bench memo review'],
    allowedTools: ['castPanelVote', 'castRuntimePanelVote', 'draftBenchMemo'],
  },
  {
    id: 'ca4_judge_3',
    label: 'Panel Judge 3',
    role: 'judge',
    authorityScope: ['panel vote', 'bench memo review'],
    allowedTools: ['castPanelVote', 'castRuntimePanelVote', 'draftBenchMemo'],
  },
  {
    id: 'ca4_panel',
    label: 'Three-Judge Panel',
    role: 'panel',
    count: 3,
    authorityScope: ['motions', 'merits disposition', 'rehearing', 'mandate'],
    allowedTools: [
      'issuePanelOrder',
      'disposeCase',
      'draftPanelDisposition',
      'draftRuntimePanelDisposition',
      'enterJudgment',
      'setMandateDeadline',
    ],
  },
  {
    id: 'public_interest_amicus',
    label: 'Potential Amicus',
    role: 'amicus',
    authorityScope: ['motion for leave', 'amicus brief'],
    allowedTools: [
      'fileCounterpartyDocument',
      'draftCounterpartyFiling',
      'recommendAmicusParticipation',
    ],
  },
]

export const courtPacks: CourtPack[] = [
  {
    id: 'us-federal-ca4-civil-appeal',
    moduleId: 'us-federal-ca4',
    label: 'U.S. Court of Appeals for the Fourth Circuit',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'civil_appeal',
    baseCourtPackIds: [],
    includedRulePackIds: ['procedure-core', 'civil-appeal', 'frap-2025'],
    rulePackIds: ['frap-2025', 'ca4-current'],
    procedureModuleIds: ['federal-civil-appeal-standard-briefing'],
    participantRoles: [
      'appellant',
      'appellee',
      'amicus',
      'clerk',
      'panel',
      'district_court',
    ],
    filingEvents: civilFilingEvents,
    aiActors,
    docketNumberFormat: '26-####',
  },
  {
    id: 'us-federal-ca4-criminal-appeal',
    moduleId: 'us-federal-ca4-criminal',
    label: 'U.S. Court of Appeals for the Fourth Circuit - Criminal Appeal',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'criminal_appeal',
    baseCourtPackIds: ['us-federal-ca4-civil-appeal'],
    includedRulePackIds: ['procedure-core', 'criminal-appeal', 'frap-2025'],
    rulePackIds: ['frap-2025', 'ca4-current'],
    procedureModuleIds: ['federal-civil-appeal-standard-briefing'],
    participantRoles: [
      'appellant',
      'appellee',
      'amicus',
      'clerk',
      'panel',
      'district_court',
    ],
    filingEvents: criminalFilingEvents,
    aiActors,
    docketNumberFormat: '26-####',
  },
  {
    id: 'us-federal-ca4-agency-review',
    moduleId: 'us-federal-ca4-agency-review',
    label: 'U.S. Court of Appeals for the Fourth Circuit - Agency Review',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'agency_review',
    baseCourtPackIds: ['us-federal-ca4-civil-appeal'],
    includedRulePackIds: ['procedure-core', 'agency-review', 'frap-2025'],
    rulePackIds: ['frap-2025', 'ca4-current'],
    procedureModuleIds: ['federal-civil-appeal-standard-briefing'],
    participantRoles: [
      'appellant',
      'appellee',
      'amicus',
      'agency',
      'clerk',
      'panel',
    ],
    filingEvents: agencyReviewFilingEvents,
    aiActors,
    docketNumberFormat: '26-####',
  },
  {
    id: 'us-federal-ca4-original-writ',
    moduleId: 'us-federal-ca4-original-writ',
    label: 'U.S. Court of Appeals for the Fourth Circuit - Original Writ',
    courtSystem: 'federal',
    courtLevel: 'intermediate_appellate',
    procedureDomain: 'original_writ',
    baseCourtPackIds: ['us-federal-ca4-civil-appeal'],
    includedRulePackIds: ['procedure-core', 'original-writ', 'frap-2025'],
    rulePackIds: ['frap-2025', 'ca4-current'],
    procedureModuleIds: ['federal-civil-appeal-standard-briefing'],
    participantRoles: [
      'appellant',
      'appellee',
      'clerk',
      'panel',
      'district_court',
    ],
    filingEvents: originalWritFilingEvents,
    aiActors,
    docketNumberFormat: '26-####',
  },
  {
    id: 'future-state-trial-template',
    moduleId: 'future-state-trial-template',
    label: 'State Trial Court Template',
    courtSystem: 'state',
    courtLevel: 'trial',
    procedureDomain: 'civil_trial',
    baseCourtPackIds: [],
    includedRulePackIds: ['procedure-core'],
    rulePackIds: [],
    procedureModuleIds: [],
    participantRoles: ['plaintiff', 'defendant', 'clerk', 'judge'],
    filingEvents: [],
    aiActors: [],
    docketNumberFormat: 'YYYY-CV-####',
  },
]

export const scenarios = scenarioSeed as Scenario[]

export function getCourtPack(courtPackId: string) {
  const pack = courtPacks.find((candidate) => candidate.id === courtPackId)
  if (!pack) {
    throw new Error(`Unknown court pack: ${courtPackId}`)
  }
  return pack
}

export function getRulePacksForCourt(courtPackId: string) {
  const courtPack = getCourtPack(courtPackId)
  const ids = new Set([...courtPack.includedRulePackIds, ...courtPack.rulePackIds])
  return rulePacks.filter((pack) => ids.has(pack.id))
}

export function getRuleItemsForCourt(courtPackId: string) {
  return getRulePacksForCourt(courtPackId).flatMap((pack) => pack.items)
}

export function getFilingEvent(courtPackId: string, eventId: string) {
  const courtPack = getCourtPack(courtPackId)
  return courtPack.filingEvents.find((event) => event.id === eventId)
}

export function getScenario(scenarioId: string) {
  const scenario = scenarios.find((candidate) => candidate.id === scenarioId)
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`)
  }
  return scenario
}

export {
  criminalAppelleeBriefDeadline,
  criminalOpeningBriefDeadline,
  criminalReplyBriefDeadline,
  openingBriefDeadline,
}
