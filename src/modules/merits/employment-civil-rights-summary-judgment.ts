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

import type { CaseSession } from '../../domain/types'
import type { MeritsModule } from '../types'

function filedEventSet(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

export const employmentCivilRightsSummaryJudgmentMerits: MeritsModule = {
  id: 'employment-civil-rights-summary-judgment',
  issueModels: [
    {
      id: 'comparator-evidence',
      label: 'Comparator evidence at summary judgment',
      standardOfReview: 'de novo',
      preservationSignals: ['opening_brief', 'record citation', 'summary judgment'],
      recordSupportSignals: ['comparator', 'pretext', 'protected activity'],
    },
    {
      id: 'evidentiary-objection',
      label: 'Late evidentiary objection',
      standardOfReview: 'abuse of discretion or forfeiture-sensitive review',
      preservationSignals: ['opening_brief', 'district court objection'],
      recordSupportSignals: ['objection', 'exhibit', 'ruling'],
    },
  ],
  reliefRules: [
    {
      id: 'vacatur-remand',
      label: 'Vacatur and remand',
      availableWhen: ['preserved reversible summary judgment error'],
      unavailableWhen: ['no opening brief', 'no record support'],
    },
    {
      id: 'affirmance',
      label: 'Affirmance',
      availableWhen: ['waiver', 'harmless error', 'no genuine dispute'],
      unavailableWhen: [],
    },
  ],
  evaluate(session: CaseSession) {
    const filedEvents = filedEventSet(session)
    const hasOpeningBrief = filedEvents.has('opening_brief')
    const hasAppendix = filedEvents.has('joint_appendix')

    return {
      moduleId: 'employment-civil-rights-summary-judgment',
      issueFindings: [
        hasOpeningBrief
          ? 'Opening brief preserved the primary comparator-evidence issue for panel review.'
          : 'No opening brief preserved a merits issue.',
        hasAppendix
          ? 'Joint appendix supports record-based review.'
          : 'Missing appendix limits realistic merits relief.',
      ],
      availableRelief:
        hasOpeningBrief && hasAppendix ? ['vacatur-remand', 'affirmance'] : ['affirmance'],
      barredRelief: hasOpeningBrief && hasAppendix ? [] : ['vacatur-remand'],
    }
  },
}
