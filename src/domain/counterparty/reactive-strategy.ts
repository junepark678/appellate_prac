import { draftCounterpartyStrategy } from './strategy'
import type { CaseSession, ToolCall } from '../types'

function latestAcceptedAppellantMotion(session: CaseSession) {
  return session.filings
    .filter(
      (filing) =>
        filing.outcome !== 'rejected' &&
        filing.participantRole === 'appellant' &&
        filing.eventId.includes('motion'),
    )
    .at(-1)
}

export function nextCounterpartyReaction(session: CaseSession): ToolCall | null {
  const openMotionResponse = session.deadlines.find(
    (deadline) =>
      deadline.status === 'open' &&
      ['motion_response', 'response_to_amicus_motion'].includes(deadline.targetEventId),
  )
  if (openMotionResponse) {
    const latestMotion = latestAcceptedAppellantMotion(session)
    return {
      tool: 'fileCounterpartyDocument',
      actorId: 'appellee_ai',
      eventId: openMotionResponse.targetEventId,
      title: openMotionResponse.targetEventId === 'response_to_amicus_motion'
        ? 'Response to Amicus Motion'
        : 'Response to Motion',
      text: latestMotion
        ? `Appellee responds to ${latestMotion.title} and requests denial or narrower procedural relief.`
        : 'Appellee responds to the pending motion and requests denial.',
    }
  }

  const strategy = session.counterpartyStrategy ?? draftCounterpartyStrategy(session)
  if (strategy.recommendedNextFilingEventId === 'appellee_brief') {
    return {
      tool: 'fileCounterpartyDocument',
      actorId: 'appellee_ai',
      eventId: 'appellee_brief',
      title: 'Appellee Brief',
      text: 'Appellee files a merits brief responding to the opening brief and defending the judgment.',
    }
  }

  return null
}
