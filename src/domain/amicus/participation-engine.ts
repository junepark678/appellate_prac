import { recommendAmicusParticipation } from './workflow'
import type { CaseSession, ToolCall } from '../types'

function filedEvents(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

export function nextAmicusParticipationAction(session: CaseSession): ToolCall | null {
  const events = filedEvents(session)
  if (!events.has('opening_brief')) return null
  if (events.has('amicus_brief') || events.has('motion_for_leave_to_file_amicus')) return null

  const participation = session.amicusParticipation ?? recommendAmicusParticipation(session)
  const candidate = participation.candidates.find((item) => item.recommended)
  if (!candidate) return null

  if (candidate.requiresLeave && candidate.consentStatus !== 'all_parties_consent') {
    return {
      tool: 'fileCounterpartyDocument',
      actorId: 'public_interest_amicus',
      eventId: 'motion_for_leave_to_file_amicus',
      title: `Motion for Leave to File Amicus Brief by ${candidate.organizationName}`,
      text: `${candidate.organizationName} seeks leave to file an amicus brief because ${candidate.rationale}`,
    }
  }

  return {
    tool: 'fileCounterpartyDocument',
    actorId: 'public_interest_amicus',
    eventId: 'amicus_brief',
    title: `Amicus Brief of ${candidate.organizationName}`,
    text: `${candidate.organizationName} files an amicus brief with a distinct interest statement supporting ${candidate.supportsRole}.`,
  }
}
