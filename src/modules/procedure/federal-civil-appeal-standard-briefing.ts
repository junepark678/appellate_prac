import type { CaseSession } from '../../domain/types'
import { ruleRefs } from '../../domain/packs'
import type { AvailableFilingEvent, ProcedureModule } from '../types'

function activeFiledEventSet(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

function eventAvailability(
  eventId: string,
  label: string,
  available: boolean,
  reasons: string[] = [],
): AvailableFilingEvent {
  return { eventId, label, available, reasons }
}

function procedureEventIds(session: CaseSession) {
  const domain = session.scenario.courtPackId.includes('criminal')
    ? 'criminal_appeal'
    : session.scenario.courtPackId.includes('agency')
      ? 'agency_review'
      : session.scenario.courtPackId.includes('original-writ')
        ? 'original_writ'
        : 'civil_appeal'

  if (domain === 'criminal_appeal') {
    return {
      opening: ['criminal_notice_of_appeal', 'Criminal Notice of Appeal'] as const,
      docketing: ['criminal_docketing_statement', 'Criminal Docketing Statement'] as const,
      record: ['transcript_order_acknowledgment', 'Transcript Order Acknowledgment'] as const,
      extraOpening: ['cja_financial_disclosure', 'CJA Financial Disclosure'] as const,
    }
  }

  if (domain === 'agency_review') {
    return {
      opening: ['petition_for_review', 'Petition for Review'] as const,
      docketing: ['agency_docketing_statement', 'Agency-Review Docketing Statement'] as const,
      record: ['certified_agency_record', 'Certified Agency Record'] as const,
      extraOpening: null,
    }
  }

  if (domain === 'original_writ') {
    return {
      opening: ['petition_for_writ_mandamus', 'Petition for Writ of Mandamus or Prohibition'] as const,
      docketing: ['writ_docketing_statement', 'Writ Docketing Statement'] as const,
      record: ['appendix_to_writ_petition', 'Appendix to Writ Petition'] as const,
      extraOpening: null,
    }
  }

  return {
    opening: ['notice_of_appeal', 'Notice of Appeal'] as const,
    docketing: ['docketing_statement', 'Docketing Statement'] as const,
    record: ['transcript_order_acknowledgment', 'Transcript Order Acknowledgment'] as const,
    extraOpening: null,
  }
}

export const federalCivilAppealStandardBriefingProcedure: ProcedureModule = {
  id: 'federal-civil-appeal-standard-briefing',
  domain: 'civil_appeal',
  initialState: 'case_opened',
  transitions: [
    {
      id: 'case-opening-notice',
      fromState: 'case_opened',
      toState: 'notice_validated',
      filingEventId: 'notice_of_appeal',
      guard: 'notice is timely and contains required notice signal',
      effect: 'satisfy notice deadline and open disclosure branch',
      ruleRefs: [ruleRefs.frap3, ruleRefs.frap4],
    },
    {
      id: 'disclosure-filed',
      fromState: 'notice_validated',
      toState: 'disclosure_complete',
      filingEventId: 'appearance_disclosure',
      guard: 'appearance/disclosure is filed by a party',
      effect: 'enable docketing statement review',
      ruleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
    },
    {
      id: 'docketing-statement-filed',
      fromState: 'disclosure_complete',
      toState: 'docketing-statement-complete',
      filingEventId: 'docketing_statement',
      guard: 'docketing statement is filed after notice',
      effect: 'enable transcript and record-ordering branch',
      ruleRefs: [ruleRefs.frap3, ruleRefs.ca4Local3],
    },
    {
      id: 'transcript-acknowledgment-filed',
      fromState: 'docketing-statement-complete',
      toState: 'record-ordering-complete',
      filingEventId: 'transcript_order_acknowledgment',
      guard: 'transcript order acknowledgment or no-transcript statement is filed',
      effect: 'enable briefing schedule',
      ruleRefs: [ruleRefs.frap10, ruleRefs.ca4Local10, ruleRefs.ca4Local11],
    },
    {
      id: 'briefing-schedule',
      fromState: 'record-ordering-complete',
      toState: 'opening-brief-due',
      actorToolName: 'setDeadline',
      guard: 'no opening brief deadline is already open',
      effect: 'set opening brief and appendix deadline',
      ruleRefs: [ruleRefs.frap31, ruleRefs.ca4Local31],
    },
    {
      id: 'opening-brief-filed',
      fromState: 'opening-brief-due',
      toState: 'appendix-review',
      filingEventId: 'opening_brief',
      guard: 'opening brief is accepted or accepted with deficiency',
      effect: 'check appendix branch and appellee briefing readiness',
      ruleRefs: [ruleRefs.frap28, ruleRefs.frap31, ruleRefs.frap32],
    },
    {
      id: 'appendix-filed',
      fromState: 'appendix-review',
      toState: 'appellee-brief-due',
      filingEventId: 'joint_appendix',
      guard: 'joint appendix is filed',
      effect: 'allow appellee brief',
      ruleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    },
    {
      id: 'motion-response-branch',
      fromState: 'any-active-state',
      toState: 'motion-response-due',
      filingEventId: 'motion',
      guard: 'motion requires response or panel referral',
      effect: 'set motion response deadline',
      ruleRefs: [ruleRefs.frap27, ruleRefs.ca4Local27],
    },
    {
      id: 'motion-response-filed',
      fromState: 'motion-response-due',
      toState: 'prior-active-state',
      filingEventId: 'motion_response',
      guard: 'response is filed by an allowed role',
      effect: 'return motion package to clerk or panel',
      ruleRefs: [ruleRefs.frap27],
    },
    {
      id: 'appellee-brief-filed',
      fromState: 'appellee-brief-due',
      toState: 'reply-brief-due',
      filingEventId: 'appellee_brief',
      guard: 'appellee brief is accepted',
      effect: 'set reply deadline',
      ruleRefs: [ruleRefs.frap31],
    },
    {
      id: 'reply-brief-filed',
      fromState: 'reply-brief-due',
      toState: 'ready-for-submission',
      filingEventId: 'reply_brief',
      guard: 'reply brief is accepted after appellee brief',
      effect: 'case is eligible for panel submission',
      ruleRefs: [ruleRefs.frap31, ruleRefs.frap34],
    },
    {
      id: 'panel-submission',
      fromState: 'ready-for-submission',
      toState: 'submitted',
      actorToolName: 'submitToPanel',
      guard: 'briefing sequence is complete',
      effect: 'submit case to panel',
      ruleRefs: [ruleRefs.frap34],
    },
    {
      id: 'panel-disposition',
      fromState: 'submitted',
      toState: 'judgment-entered',
      actorToolName: 'disposeCase',
      guard: 'valid panel votes and relief option exist',
      effect: 'enter judgment and open rehearing/mandate branch',
      ruleRefs: [ruleRefs.frap36, ruleRefs.frap41],
    },
    {
      id: 'rehearing-petition',
      fromState: 'judgment-entered',
      toState: 'rehearing-pending',
      filingEventId: 'petition_rehearing',
      guard: 'petition is timely and available after disposition',
      effect: 'distribute petition to panel',
      ruleRefs: [ruleRefs.frap40],
    },
  ],
  availableEvents(session: CaseSession) {
    const filedEvents = activeFiledEventSet(session)
    const eventIds = procedureEventIds(session)
    const [openingEventId, openingLabel] = eventIds.opening
    const [docketingEventId, docketingLabel] = eventIds.docketing
    const [recordEventId, recordLabel] = eventIds.record
    const openingFiled = filedEvents.has(openingEventId)
    const extraOpeningReady =
      !eventIds.extraOpening || filedEvents.has(eventIds.extraOpening[0])
    const openingPrerequisitesReady =
      filedEvents.has('appearance_disclosure') &&
      filedEvents.has(docketingEventId) &&
      filedEvents.has(recordEventId) &&
      extraOpeningReady

    return [
      eventAvailability(
        openingEventId,
        openingLabel,
        !openingFiled,
        openingFiled ? ['Case-initiating filing already filed.'] : [],
      ),
      eventAvailability(
        'appearance_disclosure',
        'Appearance / Disclosure Statement',
        openingFiled && !filedEvents.has('appearance_disclosure'),
        openingFiled
          ? []
          : ['Case-initiating filing should be filed first.'],
      ),
      eventAvailability(
        docketingEventId,
        docketingLabel,
        openingFiled && !filedEvents.has(docketingEventId),
        openingFiled
          ? []
          : ['Case-initiating filing should be filed first.'],
      ),
      ...(eventIds.extraOpening
        ? [
            eventAvailability(
              eventIds.extraOpening[0],
              eventIds.extraOpening[1],
              openingFiled && !filedEvents.has(eventIds.extraOpening[0]),
              openingFiled ? [] : ['Case-initiating filing should be filed first.'],
            ),
          ]
        : []),
      eventAvailability(
        recordEventId,
        recordLabel,
        openingFiled && !filedEvents.has(recordEventId),
        openingFiled
          ? []
          : ['Case-initiating filing should be filed first.'],
      ),
      eventAvailability(
        'opening_brief',
        'Opening Brief',
        openingPrerequisitesReady && !filedEvents.has('opening_brief'),
        openingPrerequisitesReady
          ? []
          : ['Opening-stage appearance, docketing, or transcript-order filing remains pending.'],
      ),
      eventAvailability(
        'joint_appendix',
        'Joint Appendix',
        filedEvents.has('opening_brief') && !filedEvents.has('joint_appendix'),
        filedEvents.has('opening_brief') ? [] : ['Opening brief should be filed first.'],
      ),
      eventAvailability(
        'reply_brief',
        'Reply Brief',
        filedEvents.has('appellee_brief') && !filedEvents.has('reply_brief'),
        filedEvents.has('appellee_brief') ? [] : ['Appellee brief is not on file.'],
      ),
      eventAvailability('motion', 'Motion', session.status === 'active'),
      eventAvailability('motion_extend_time', 'Motion to Extend Time', session.status === 'active'),
      eventAvailability(
        'motion_overlength_brief',
        'Motion to File Overlength Brief',
        session.status === 'active',
      ),
      eventAvailability('motion_to_seal', 'Motion to Seal', session.status === 'active'),
      eventAvailability(
        'motion_stay_pending_appeal',
        'Motion to Stay or for Injunction Pending Appeal',
        session.status === 'active',
      ),
      eventAvailability(
        'motion_to_supplement_record',
        'Motion to Supplement Record',
        session.status === 'active' && filedEvents.has('certified_agency_record'),
        filedEvents.has('certified_agency_record')
          ? []
          : ['Agency record should be filed first.'],
      ),
      eventAvailability(
        'emergency_motion_stay',
        'Emergency Motion for Stay',
        session.status === 'active' && openingFiled,
        openingFiled ? [] : ['Case-initiating filing should be filed first.'],
      ),
      eventAvailability(
        'appendix_to_writ_petition',
        'Appendix to Writ Petition',
        session.status === 'active' && filedEvents.has('petition_for_writ_mandamus'),
        filedEvents.has('petition_for_writ_mandamus')
          ? []
          : ['Writ petition should be filed first.'],
      ),
      eventAvailability(
        'answer_to_writ_petition',
        'Answer to Writ Petition',
        session.status === 'active' && filedEvents.has('order_inviting_answer'),
        filedEvents.has('order_inviting_answer')
          ? []
          : ['Court order inviting an answer has not been entered.'],
      ),
      eventAvailability(
        'reply_in_support_of_writ',
        'Reply in Support of Writ Petition',
        session.status === 'active' && filedEvents.has('answer_to_writ_petition'),
        filedEvents.has('answer_to_writ_petition') ? [] : ['Answer is not on file.'],
      ),
      eventAvailability(
        'sealed_filing_acknowledgment',
        'Sealed Filing Acknowledgment',
        session.status === 'active',
      ),
      eventAvailability('motion_response', 'Response to Motion', session.status === 'active'),
      eventAvailability(
        'response_to_amicus_motion',
        'Response to Amicus Motion',
        session.status === 'active',
      ),
      eventAvailability('amicus_notice_or_consent', 'Amicus Notice / Consent Statement', session.status === 'active'),
      eventAvailability('motion_for_leave_to_file_amicus', 'Motion for Leave to File Amicus Brief', session.status === 'active'),
      eventAvailability('amicus_brief', 'Amicus Brief', session.status === 'active'),
      eventAvailability('rule_28j_letter', 'Rule 28(j) Letter', session.status === 'active'),
      eventAvailability(
        'corrected_brief',
        'Corrected Brief',
        session.filings.some((filing) => filing.outcome === 'accepted_with_deficiency'),
        session.filings.some((filing) => filing.outcome === 'accepted_with_deficiency')
          ? []
          : ['No accepted filing deficiency is pending.'],
      ),
      eventAvailability(
        'petition_rehearing',
        'Panel or En Banc Rehearing Petition',
        session.status === 'closed',
        session.status === 'closed' ? [] : ['Disposition has not been entered.'],
      ),
      eventAvailability(
        'mandate_stay_motion',
        'Motion to Stay Mandate',
        session.status === 'closed',
        session.status === 'closed' ? [] : ['Judgment has not been entered.'],
      ),
      eventAvailability(
        'bill_of_costs',
        'Bill of Costs',
        session.status === 'closed',
        session.status === 'closed' ? [] : ['Judgment has not been entered.'],
      ),
    ]
  },
}
