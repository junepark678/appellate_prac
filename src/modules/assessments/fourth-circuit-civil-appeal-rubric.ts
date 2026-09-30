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

import type { AssessmentModule } from '../types'

export const fourthCircuitCivilAppealAssessment: AssessmentModule = {
  id: 'fourth-circuit-civil-appeal-rubric',
  rubric: {
    id: 'fourth-circuit-civil-appeal-beta',
    criteria: [
      { id: 'filing_accuracy', label: 'Filing accuracy', maxScore: 20 },
      { id: 'deadline_compliance', label: 'Deadline compliance', maxScore: 15 },
      { id: 'procedural_strategy', label: 'Procedural strategy', maxScore: 20 },
      { id: 'merits_preservation', label: 'Merits preservation', maxScore: 20 },
      { id: 'relief_realism', label: 'Relief realism', maxScore: 15 },
      { id: 'record_use', label: 'Record use', maxScore: 10 },
    ],
  },
  assess(session) {
    const rejectedEntryCount = session.docketEntries.filter(
      (entry) => entry.title === 'Clerk Notice of Rejected Filing',
    ).length
    const deficiencyFilings = session.filings.filter(
      (filing) => filing.outcome === 'accepted_with_deficiency',
    )
    const filedEvents = new Set(
      session.filings
        .filter((filing) => filing.outcome !== 'rejected')
        .map((filing) => filing.eventId),
    )

    return {
      disposition: session.assessment?.disposition ?? 'Assessment',
      score: Math.max(
        0,
        100 -
          rejectedEntryCount * 20 -
          deficiencyFilings.length * 10 -
          (filedEvents.has('joint_appendix') ? 0 : 12) -
          (filedEvents.has('appearance_disclosure') ? 0 : 10),
      ),
      proceduralFindings: [
        rejectedEntryCount
          ? `${rejectedEntryCount} filing was rejected before reaching the docket.`
          : 'No filing was rejected outright.',
        deficiencyFilings.length
          ? `${deficiencyFilings.length} accepted filing generated a clerk deficiency notice.`
          : 'No accepted filing generated a deficiency notice.',
      ],
      meritsFindings: [
        'Assessment rubric tracks filing accuracy, deadline compliance, preservation, relief, and record use.',
      ],
      nextPracticeTargets: [
        'File the appearance/disclosure statement before briefing.',
        'Pair the opening brief with the required appendix workflow.',
        'Preserve every issue in the opening brief with record citations.',
      ],
    }
  },
}
