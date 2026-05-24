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
