import { evaluateIssues, evaluateRelief, scenarioIssues } from '../legal/evaluators'
import type { CaseSession, CounterpartyStrategy, FilingRecord } from '../types'

function activeFiledEventSet(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

function openResponseDeadline(session: CaseSession) {
  return session.deadlines.find(
    (deadline) =>
      deadline.status === 'open' &&
      ['motion_response', 'response_to_amicus_motion'].includes(deadline.targetEventId),
  )
}

function filingText(filing?: FilingRecord) {
  return filing?.documents
    .flatMap((document) => [
      document.fileName,
      document.extractedText ?? '',
      ...document.extractedSignals,
    ])
    .join(' ')
    .toLowerCase() ?? ''
}

function latestAppellantFiling(session: CaseSession) {
  return session.filings
    .filter((filing) => filing.participantRole === 'appellant' && filing.outcome !== 'rejected')
    .at(-1)
}

export function draftCounterpartyStrategy(session: CaseSession): CounterpartyStrategy {
  const filedEvents = activeFiledEventSet(session)
  const latest = latestAppellantFiling(session)
  const latestText = filingText(latest)
  const issueEvaluations = evaluateIssues(session)
  const relief = evaluateRelief(session)
  const responseDeadline = openResponseDeadline(session)

  const preservedIssues = issueEvaluations
    .filter((issue) => issue.preservationStatus === 'preserved')
    .map((issue) => issue.label)

  const forfeitureArguments = issueEvaluations
    .filter((issue) => issue.preservationStatus !== 'preserved')
    .map((issue) => `${issue.label}: ${issue.preservationStatus} or inadequately developed.`)

  const jurisdictionArguments = [
    !filedEvents.has('notice_of_appeal')
      ? 'The appeal cannot proceed without a valid notice of appeal.'
      : '',
    latest?.eventId === 'opening_brief' && !latestText.includes('jurisdiction')
      ? 'The opening brief does not show a strong jurisdictional statement signal.'
      : '',
  ].filter(Boolean)

  const meritsArguments = scenarioIssues(session).flatMap((issue) =>
    issue.likelyArgumentsForAppellee.length
      ? issue.likelyArgumentsForAppellee
      : [`Affirm on ${issue.label}.`],
  )

  const proceduralMotions = [
    !filedEvents.has('joint_appendix') && filedEvents.has('opening_brief')
      ? 'Move to strike or request appendix deficiency relief if record materials remain absent.'
      : '',
    relief.availableRelief.length === 1 && relief.availableRelief[0] === 'affirm'
      ? 'Emphasize procedural default and harmless error to narrow relief.'
      : '',
  ].filter(Boolean)

  return {
    id: `strategy_${session.filings.length}_${session.docketEntries.length}`,
    caseSessionId: session.id,
    preservedIssues,
    forfeitureArguments,
    jurisdictionArguments,
    meritsArguments,
    proceduralMotions,
    ...(responseDeadline
      ? { recommendedNextFilingEventId: responseDeadline.targetEventId }
      : filedEvents.has('opening_brief') && filedEvents.has('joint_appendix') && !filedEvents.has('appellee_brief')
        ? { recommendedNextFilingEventId: 'appellee_brief' }
        : {}),
    updatedAt: session.simulatedDate,
  }
}

export function withCounterpartyStrategy(session: CaseSession): CaseSession {
  const latest = latestAppellantFiling(session)
  if (!latest) return session
  return {
    ...session,
    counterpartyStrategy: draftCounterpartyStrategy(session),
  }
}

export function counterpartyBriefText(session: CaseSession) {
  const strategy = session.counterpartyStrategy ?? draftCounterpartyStrategy(session)
  const forfeiture = strategy.forfeitureArguments.length
    ? ` Appellee also argues forfeiture: ${strategy.forfeitureArguments.join(' ')}`
    : ''
  const merits = strategy.meritsArguments.slice(0, 3).join(' ')

  return `Appellee asks the court to affirm. ${merits}${forfeiture}`
}
