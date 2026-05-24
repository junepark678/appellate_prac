import { openingBriefDeadline, ruleRefs } from '../../modules/registry'
import { applyToolCall } from '../simulation'
import type {
  CaseSession,
  ProcedureState,
  StateTransitionResult,
  ToolCall,
} from '../types'

function activeFiledEventSet(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

function hasOpenDeadline(session: CaseSession, targetEventId: string) {
  return session.deadlines.some(
    (deadline) => deadline.targetEventId === targetEventId && deadline.status === 'open',
  )
}

export function inferProcedureState(session: CaseSession): ProcedureState {
  if (session.status === 'dismissed') return 'dismissed'
  if (session.status === 'closed') {
    const filedEvents = activeFiledEventSet(session)
    return filedEvents.has('petition_rehearing') ? 'rehearing_pending' : 'judgment_entered'
  }
  if (session.status === 'submitted') return 'submitted'

  const filedEvents = activeFiledEventSet(session)
  if (!filedEvents.has('notice_of_appeal')) return 'notice_pending'
  if (!filedEvents.has('appearance_disclosure')) return 'appearance_pending'
  if (!hasOpenDeadline(session, openingBriefDeadline.targetEventId) && !filedEvents.has('opening_brief')) {
    return 'briefing_schedule_pending'
  }
  if (!filedEvents.has('opening_brief')) return 'opening_brief_pending'
  if (!filedEvents.has('joint_appendix')) return 'appendix_pending'
  if (!filedEvents.has('appellee_brief')) return 'appellee_brief_pending'
  if (!filedEvents.has('reply_brief')) return 'reply_brief_pending'
  return 'panel_deliberation'
}

export function nextProcedureToolCall(session: CaseSession): ToolCall {
  const state = session.procedureState ?? inferProcedureState(session)

  if (state === 'notice_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Notice Regarding Case Opening',
      text: 'The appeal is opened for training purposes. Appellant must file a notice of appeal and required appearance/disclosure materials before merits briefing proceeds.',
      ruleRefs: [ruleRefs.frap3, ruleRefs.frap4, ruleRefs.ca4Local12],
    }
  }

  if (state === 'appearance_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Directing Disclosure Statement',
      text: 'Appellant is directed to file an appearance and disclosure statement. Failure to comply may delay briefing or result in further order.',
      ruleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local12],
    }
  }

  if (state === 'briefing_schedule_pending') {
    return {
      tool: 'setDeadline',
      actorId: 'ca4_clerk',
      label: openingBriefDeadline.label,
      targetEventId: openingBriefDeadline.targetEventId,
      offsetDays: openingBriefDeadline.offsetDays,
      sourceRuleRefs: openingBriefDeadline.sourceRuleRefs,
    }
  }

  if (state === 'appendix_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Regarding Appendix',
      text: 'The opening brief has been received, but the joint appendix has not been filed. Appellant must cure the appendix deficiency before the case is submitted.',
      ruleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    }
  }

  if (state === 'appellee_brief_pending') {
    return {
      tool: 'fileCounterpartyDocument',
      actorId: 'appellee_ai',
      eventId: 'appellee_brief',
      title: 'Appellee Brief',
      text: 'Appellee files a brief defending summary judgment and arguing that appellant failed to preserve several evidentiary objections.',
    }
  }

  if (state === 'reply_brief_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Briefing Notice',
      text: 'Appellant may file a reply brief within the example deadline. The case will be eligible for panel submission after briefing is complete.',
      ruleRefs: [ruleRefs.frap31],
    }
  }

  if (state === 'panel_deliberation') {
    return {
      tool: 'submitToPanel',
      actorId: 'ca4_clerk',
      text: 'Briefing is complete. The case is submitted to the three-judge panel without oral argument for this simulation run.',
    }
  }

  if (state === 'submitted') {
    return {
      tool: 'disposeCase',
      actorId: 'ca4_panel',
      disposition: 'Opinion and Judgment',
      text: 'The judgment is vacated in part and remanded. The panel concludes that the district court applied the correct summary judgment standard but failed to view comparator evidence in the light most favorable to appellant. Appellant forfeited a separate evidentiary objection by failing to develop it in the opening brief.',
      ruleRefs: [ruleRefs.frap28, ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
    }
  }

  return {
    tool: 'issueClerkOrder',
    actorId: 'ca4_clerk',
    title: 'No Automatic Procedure Event Available',
    text: 'The current posture requires a learner filing or instructor review before the simulator can advance.',
    ruleRefs: [ruleRefs.ca4Local45],
  }
}

export function transitionAfterFiling(session: CaseSession): CaseSession {
  return {
    ...session,
    procedureState: inferProcedureState(session),
  }
}

export function advanceProcedure(session: CaseSession): {
  session: CaseSession
  toolCall: ToolCall
  transition: StateTransitionResult
} {
  const fromState = session.procedureState ?? inferProcedureState(session)
  const toolCall = nextProcedureToolCall({ ...session, procedureState: fromState })
  const nextSession = transitionAfterFiling(applyToolCall(session, toolCall))
  const toState = nextSession.procedureState ?? inferProcedureState(nextSession)

  return {
    session: nextSession,
    toolCall,
    transition: {
      accepted: true,
      fromState,
      toState,
      warnings: [],
      docketEffects: [],
      deadlineEffects: [],
    },
  }
}

