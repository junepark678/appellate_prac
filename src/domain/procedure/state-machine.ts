/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { criminalOpeningBriefDeadline, openingBriefDeadline, ruleRefs } from '../packs'
import { applyToolCall } from '../simulation'
import {
  createBenchMemo,
  createPanelDisposition,
  deterministicPanelVote,
  nextPanelJudgeActorId,
} from '../panel/deliberation'
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

function procedureEventIds(session: CaseSession) {
  if (session.courtPackId.includes('criminal')) {
    return {
      opening: 'criminal_notice_of_appeal',
      docketing: 'criminal_docketing_statement',
      record: 'transcript_order_acknowledgment',
      extra: 'cja_financial_disclosure',
      openingDeadline: criminalOpeningBriefDeadline,
    }
  }
  if (session.courtPackId.includes('agency')) {
    return {
      opening: 'petition_for_review',
      docketing: 'agency_docketing_statement',
      record: 'certified_agency_record',
      extra: undefined,
      openingDeadline: openingBriefDeadline,
    }
  }
  if (session.courtPackId.includes('original-writ')) {
    return {
      opening: 'petition_for_writ_mandamus',
      docketing: 'writ_docketing_statement',
      record: 'appendix_to_writ_petition',
      extra: undefined,
      openingDeadline: openingBriefDeadline,
    }
  }
  return {
    opening: 'notice_of_appeal',
    docketing: 'docketing_statement',
    record: 'transcript_order_acknowledgment',
    extra: undefined,
    openingDeadline: openingBriefDeadline,
  }
}

export function inferProcedureState(session: CaseSession): ProcedureState {
  if (session.status === 'dismissed') return 'dismissed'
  if (session.status === 'closed') {
    const filedEvents = activeFiledEventSet(session)
    return filedEvents.has('petition_rehearing') ? 'rehearing_pending' : 'judgment_entered'
  }
  if (session.status === 'submitted') return 'panel_deliberation'

  const filedEvents = activeFiledEventSet(session)
  const eventIds = procedureEventIds(session)
  if (!filedEvents.has(eventIds.opening)) return 'notice_pending'
  if (!filedEvents.has('appearance_disclosure')) return 'appearance_pending'
  if (!filedEvents.has(eventIds.docketing)) return 'docketing_statement_pending'
  if (eventIds.extra && !filedEvents.has(eventIds.extra)) return 'fee_or_ifp_pending'
  if (!filedEvents.has(eventIds.record)) return 'record_ordering_pending'
  if (session.courtPackId.includes('original-writ')) {
    if (!filedEvents.has('answer_to_writ_petition')) return 'motion_pending'
    if (!filedEvents.has('reply_in_support_of_writ')) return 'reply_brief_pending'
    return 'panel_deliberation'
  }
  if (!hasOpenDeadline(session, eventIds.openingDeadline.targetEventId) && !filedEvents.has('opening_brief')) {
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
  const eventIds = procedureEventIds(session)

  if (state === 'notice_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Notice Regarding Case Opening',
      text: 'The proceeding is opened for training purposes. The initiating party must file the required case-opening paper and appearance/disclosure materials before merits briefing proceeds.',
      ruleRefs: eventIds.opening === 'petition_for_review'
        ? [ruleRefs.frap15, ruleRefs.ca4Local15, ruleRefs.ca4Local26_1]
        : eventIds.opening === 'petition_for_writ_mandamus'
          ? [ruleRefs.frap21, ruleRefs.ca4Local21, ruleRefs.ca4Local26_1]
          : eventIds.opening === 'criminal_notice_of_appeal'
            ? [ruleRefs.frap3, ruleRefs.frap4b, ruleRefs.ca4Local26_1]
            : [ruleRefs.frap3, ruleRefs.frap4, ruleRefs.ca4Local3, ruleRefs.ca4Local26_1],
    }
  }

  if (state === 'appearance_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Directing Disclosure Statement',
      text: 'Appellant is directed to file an appearance and disclosure statement. Failure to comply may delay briefing or result in further order.',
      ruleRefs: [ruleRefs.frap26_1, ruleRefs.ca4Local26_1],
    }
  }

  if (state === 'docketing_statement_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Directing Docketing Statement',
      text: 'Appellant is directed to file the docketing statement so jurisdictional and opening-stage information can be reviewed before merits briefing.',
      ruleRefs: eventIds.opening === 'petition_for_review'
        ? [ruleRefs.frap15, ruleRefs.ca4Local15, ruleRefs.ca4Local45]
        : eventIds.opening === 'petition_for_writ_mandamus'
          ? [ruleRefs.frap21, ruleRefs.ca4Local21, ruleRefs.ca4Local45]
          : [ruleRefs.frap3, ruleRefs.ca4Local3, ruleRefs.ca4Local45],
    }
  }

  if (state === 'fee_or_ifp_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Clerk Order Regarding CJA Financial Disclosure',
      text: 'Appellant must file the required financial disclosure or CJA-related statement before criminal briefing is scheduled.',
      ruleRefs: [ruleRefs.frap9, ruleRefs.ca4Local9],
    }
  }

  if (state === 'record_ordering_pending') {
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: eventIds.record === 'certified_agency_record'
        ? 'Clerk Order Regarding Agency Record'
        : eventIds.record === 'appendix_to_writ_petition'
          ? 'Clerk Order Regarding Writ Appendix'
          : 'Clerk Order Regarding Transcript Order',
      text: eventIds.record === 'certified_agency_record'
        ? 'The agency record, certified list, or record-complete signal must be filed before merits briefing is scheduled.'
        : eventIds.record === 'appendix_to_writ_petition'
          ? 'The writ petition requires essential orders or record excerpts before the petition can be screened for answer or disposition.'
          : 'Appellant must file a transcript order acknowledgment or confirm that no transcript is necessary before the opening brief schedule is set.',
      ruleRefs: eventIds.record === 'certified_agency_record'
        ? [ruleRefs.frap16, ruleRefs.frap17]
        : eventIds.record === 'appendix_to_writ_petition'
          ? [ruleRefs.frap21, ruleRefs.ca4Local21]
          : [ruleRefs.frap10, ruleRefs.ca4Local10, ruleRefs.ca4Local11],
    }
  }

  if (state === 'briefing_schedule_pending') {
    return {
      tool: 'setDeadline',
      actorId: 'ca4_clerk',
      label: eventIds.openingDeadline.label,
      targetEventId: eventIds.openingDeadline.targetEventId,
      offsetDays: eventIds.openingDeadline.offsetDays,
      sourceRuleRefs: eventIds.openingDeadline.sourceRuleRefs,
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
    if (session.courtPackId.includes('original-writ')) {
      return {
        tool: 'issueClerkOrder',
        actorId: 'ca4_clerk',
        title: 'Writ Reply Notice',
        text: 'The answer to the writ petition has been filed. Petitioner may file any permitted reply before the petition package is submitted to the panel.',
        ruleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      }
    }
    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Briefing Notice',
      text: 'Appellant may file a reply brief within the example deadline. The case will be eligible for panel submission after briefing is complete.',
      ruleRefs: [ruleRefs.frap31],
    }
  }

  if (state === 'motion_pending' && session.courtPackId.includes('original-writ')) {
    if (!hasOpenDeadline(session, 'answer_to_writ_petition')) {
      return {
        tool: 'setDeadline',
        actorId: 'ca4_clerk',
        label: 'Answer to writ petition due',
        targetEventId: 'answer_to_writ_petition',
        offsetDays: 14,
        sourceRuleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
      }
    }

    return {
      tool: 'issueClerkOrder',
      actorId: 'ca4_clerk',
      title: 'Writ Answer Pending',
      text: 'The answer deadline is already open. Awaiting respondent filing before further writ screening action.',
      ruleRefs: [ruleRefs.frap21, ruleRefs.ca4Local21],
    }
  }

  if (state === 'panel_deliberation') {
    if (session.status === 'submitted' && !session.benchMemo) {
      const memo = createBenchMemo(session)
      return {
        tool: 'draftStaffMemo',
        actorId: 'ca4_staff_attorney',
        text: memo.issueSummaries.join(' '),
        issueSummaries: memo.issueSummaries,
        recommendedDisposition: memo.recommendedDisposition,
        risks: memo.risks,
      }
    }

    if (
      session.status === 'submitted' &&
      (session.panelDeliberation?.votes.length ?? 0) < 3
    ) {
      const judgeActorId = nextPanelJudgeActorId(session) ?? 'ca4_judge_1'
      const vote = deterministicPanelVote(session, judgeActorId)
      return {
        tool: 'castRuntimePanelVote',
        actorId: vote.judgeActorId,
        vote: vote.vote,
        reliefOption: vote.reliefOption,
        rationale: vote.rationale,
        joinsMajority: vote.joinsMajority,
        ...(vote.separateWritingType ? { separateWritingType: vote.separateWritingType } : {}),
        confidence: vote.confidence,
      }
    }

    if (session.status === 'submitted' && !session.panelDisposition) {
      const disposition = createPanelDisposition(session)
      return {
        tool: 'draftRuntimePanelDisposition',
        actorId: 'ca4_panel',
        disposition: disposition.disposition,
        text: disposition.judgmentText,
        judgmentText: disposition.judgmentText,
        ruleRefs: disposition.ruleRefs,
      }
    }

    if (session.status === 'submitted' && session.panelDisposition) {
      return {
        tool: 'enterJudgment',
        actorId: 'ca4_panel',
        disposition: session.panelDisposition.disposition,
        judgmentText: session.panelDisposition.judgmentText,
        ruleRefs: [ruleRefs.frap36, ruleRefs.frap41],
      }
    }

    return {
      tool: 'submitToPanel',
      actorId: 'ca4_clerk',
      text: 'Briefing is complete. The case is submitted to the three-judge panel without oral argument for this simulation run.',
    }
  }

  if (state === 'submitted') {
    return nextProcedureToolCall({ ...session, procedureState: 'panel_deliberation' })
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
