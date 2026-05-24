import type {
  CaseSession,
  PanelConference,
  PanelDispositionRecord,
  PanelJudgeProfile,
  PanelVote,
} from '../types'

export const defaultPanelJudgeProfiles: PanelJudgeProfile[] = [
  {
    actorId: 'ca4_judge_1',
    seat: 'one',
    panelRole: 'presiding',
    decisionStyle: 'record_focused',
    argumentSensitivity: 'medium',
    jurisdictionSensitivity: 'high',
  },
  {
    actorId: 'ca4_judge_2',
    seat: 'two',
    panelRole: 'panelist',
    decisionStyle: 'doctrinal',
    argumentSensitivity: 'high',
    jurisdictionSensitivity: 'medium',
  },
  {
    actorId: 'ca4_judge_3',
    seat: 'three',
    panelRole: 'panelist',
    decisionStyle: 'minimalist',
    argumentSensitivity: 'low',
    jurisdictionSensitivity: 'medium',
  },
]

function majorityVote(votes: PanelVote[]) {
  const counts = new Map<PanelVote['vote'], number>()
  for (const vote of votes) counts.set(vote.vote, (counts.get(vote.vote) ?? 0) + 1)
  return [...counts.entries()].find(([, count]) => count >= 2)?.[0]
}

export function formPanelConference(session: CaseSession): PanelConference | null {
  const assignment = session.panelAssignment
  const votes = session.panelDeliberation?.votes ?? []
  if (!assignment || votes.length < 3) return null
  const uniqueJudgeIds = new Set(votes.map((vote) => vote.judgeActorId))
  if (uniqueJudgeIds.size < 3) return null
  const majority = majorityVote(votes)
  if (!majority) return null

  return {
    id: `panel_conference_${session.docketEntries.length}`,
    judgeActorIds: assignment.judgeActorIds,
    issueVotes: votes.map((vote) => ({
      judgeActorId: vote.judgeActorId,
      vote: vote.vote,
      reliefOption: vote.reliefOption,
    })),
    majorityResult: majority,
    separateWritingAssignments: votes
      .filter((vote) => vote.separateWritingType)
      .map((vote) => ({
        judgeActorId: vote.judgeActorId,
        type: vote.separateWritingType as NonNullable<PanelVote['separateWritingType']>,
      })),
  }
}

export function panelDispositionHasValidConference(
  session: CaseSession,
  disposition: PanelDispositionRecord,
) {
  const conference = formPanelConference(session)
  if (!conference) return false
  return disposition.majorityJudgeActorIds.length >= 2
}
