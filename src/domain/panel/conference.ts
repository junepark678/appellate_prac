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
