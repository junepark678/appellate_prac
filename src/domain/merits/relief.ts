import type { CaseSession, IssueEvaluation, ReliefEvaluation } from '../types'

function filedEventSet(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

export function evaluateCivilRightsSummaryJudgmentIssues(
  session: CaseSession,
): IssueEvaluation[] {
  const filedEvents = filedEventSet(session)
  const hasOpeningBrief = filedEvents.has('opening_brief')
  const hasAppendix = filedEvents.has('joint_appendix')

  return [
    {
      issueId: 'comparator-evidence',
      label: 'Comparator evidence at summary judgment',
      standardOfReview: 'de novo',
      preservationStatus: hasOpeningBrief ? 'preserved' : 'forfeited',
      waiverOrForfeitureRisk: hasOpeningBrief ? 'low' : 'high',
      recordSupport: hasAppendix ? 'strong' : 'missing',
      harmlessErrorPosture: hasAppendix ? 'prejudicial_possible' : 'harmless_likely',
      requestedRelief: ['vacate in part', 'remand'],
    },
    {
      issueId: 'late-evidentiary-objection',
      label: 'Late evidentiary objection',
      standardOfReview: 'abuse of discretion or forfeiture-sensitive review',
      preservationStatus: hasOpeningBrief ? 'unclear' : 'forfeited',
      waiverOrForfeitureRisk: 'medium',
      recordSupport: hasAppendix ? 'mixed' : 'missing',
      harmlessErrorPosture: 'harmless_likely',
      requestedRelief: ['reverse', 'remand'],
    },
  ]
}

export function evaluateRelief(session: CaseSession): ReliefEvaluation {
  const issues = evaluateCivilRightsSummaryJudgmentIssues(session)
  const preservedRecordIssue = issues.some(
    (issue) =>
      issue.preservationStatus === 'preserved' &&
      ['strong', 'mixed'].includes(issue.recordSupport),
  )

  if (session.status === 'dismissed' || session.procedureState === 'dismissed') {
    return {
      availableRelief: ['dismiss for default', 'dismiss for lack of jurisdiction'],
      barredRelief: ['vacate', 'reverse', 'remand'],
      reasons: ['The case is in a dismissal posture, so merits relief is unavailable.'],
    }
  }

  return {
    availableRelief: preservedRecordIssue
      ? ['affirm', 'vacate', 'vacate in part', 'remand']
      : ['affirm'],
    barredRelief: preservedRecordIssue ? ['dismiss for default'] : ['reverse', 'vacate', 'remand'],
    reasons: preservedRecordIssue
      ? ['A preserved issue with record support allows realistic vacatur/remand relief.']
      : ['Missing preservation or appendix support limits realistic relief to affirmance.'],
  }
}

