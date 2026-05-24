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

const ca4RulesSource = 'https://www.ca4.uscourts.gov/rules-and-procedures'

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
  frap10: {
    ruleId: 'FRAP_10',
    label: 'Fed. R. App. P. 10',
    sourceUrl: usCourtsFrapSource,
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
  sourceRuleRefs: [ruleRefs.frap31],
}

const replyBriefDeadline: DeadlineEffect = {
  targetEventId: 'reply_brief',
  offsetDays: 21,
  label: 'Reply brief due',
  sourceRuleRefs: [ruleRefs.frap31],
}

const pdfRequirement = (id: string, label: string, maxPages?: number) => ({
  id,
  label,
  required: true,
  acceptedMimeTypes: ['application/pdf'],
  maxPages,
})

export const filingEvents: FilingEvent[] = [
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
    validationRuleRefs: [ruleRefs.frap3, ruleRefs.frap4],
    deadlineEffects: [
      {
        targetEventId: 'appearance_disclosure',
        offsetDays: 14,
        label: 'Appearance and disclosure statement due',
        sourceRuleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local12],
      },
    ],
    docketTextTemplate:
      'Notice of appeal filed by {participant}. Civil appeal opened.',
    possibleClerkResponses: ['Case opened', 'Notice docketed with fee issue'],
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
    validationRuleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local12],
    deadlineEffects: [],
    docketTextTemplate: 'Appearance and disclosure statement filed by {participant}.',
    possibleClerkResponses: ['Filed', 'Corporate disclosure deficiency noted'],
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
    validationRuleRefs: [ruleRefs.frap28, ruleRefs.frap31, ruleRefs.frap32],
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
    validationRuleRefs: [ruleRefs.frap28, ruleRefs.frap31, ruleRefs.frap32],
    deadlineEffects: [],
    docketTextTemplate: 'Reply brief filed by {participant}.',
    possibleClerkResponses: ['Brief accepted', 'Submitted to panel'],
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
    validationRuleRefs: [ruleRefs.frap40],
    deadlineEffects: [],
    docketTextTemplate: 'Petition for rehearing filed by {participant}.',
    possibleClerkResponses: ['Distributed to panel', 'Denied as untimely'],
  },
]

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
    ruleId: 'CA4_LR_12',
    topic: 'appearance_disclosure',
    effectiveFrom: '2026-05-23',
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
    ruleId: 'CA4_LR_27',
    topic: 'motions',
    effectiveFrom: '2026-05-23',
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
    effectiveFrom: '2026-05-23',
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
    effectiveFrom: '2026-05-23',
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
    effectiveFrom: '2026-05-23',
    sourceLabel: 'Fourth Circuit Local Rules and IOPs',
    sourceUrl: ca4RulesSource,
    plainText: 'Fourth Circuit local practice supplements federal briefing schedules.',
    structuredConstraints: [
      { kind: 'deadline', value: 'local briefing schedule handling' },
    ],
    simulatorNotes:
      'The default opening-brief deadline cites both FRAP and Fourth Circuit practice.',
  },
  {
    jurisdiction: 'us-federal-ca4',
    ruleId: 'CA4_LR_45',
    topic: 'clerk_authority',
    effectiveFrom: '2026-05-23',
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
    version: '2026-05-23',
    sourceUrl: ca4RulesSource,
    sourceVersionIds: ['ca4-current:2026-05-23'],
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
    allowedTools: ['fileCounterpartyDocument', 'draftCounterpartyFiling'],
  },
  {
    id: 'ca4_staff_attorney',
    label: 'Staff Attorney',
    role: 'judge',
    authorityScope: ['screening memos', 'procedural recommendations'],
    allowedTools: ['draftBenchMemo', 'recommendClerkAction'],
  },
  {
    id: 'ca4_judge_1',
    label: 'Panel Judge 1',
    role: 'judge',
    authorityScope: ['panel vote', 'bench memo review'],
    allowedTools: ['castPanelVote', 'draftBenchMemo'],
  },
  {
    id: 'ca4_judge_2',
    label: 'Panel Judge 2',
    role: 'judge',
    authorityScope: ['panel vote', 'bench memo review'],
    allowedTools: ['castPanelVote', 'draftBenchMemo'],
  },
  {
    id: 'ca4_judge_3',
    label: 'Panel Judge 3',
    role: 'judge',
    authorityScope: ['panel vote', 'bench memo review'],
    allowedTools: ['castPanelVote', 'draftBenchMemo'],
  },
  {
    id: 'ca4_panel',
    label: 'Three-Judge Panel',
    role: 'panel',
    count: 3,
    authorityScope: ['motions', 'merits disposition', 'rehearing', 'mandate'],
    allowedTools: ['issuePanelOrder', 'disposeCase', 'draftPanelDisposition'],
  },
  {
    id: 'public_interest_amicus',
    label: 'Potential Amicus',
    role: 'amicus',
    authorityScope: ['motion for leave', 'amicus brief'],
    allowedTools: ['fileCounterpartyDocument', 'recommendAmicusParticipation'],
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
    filingEvents,
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

export { openingBriefDeadline }
