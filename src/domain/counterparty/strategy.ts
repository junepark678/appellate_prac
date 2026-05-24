import { evaluateIssues, evaluateRelief, scenarioIssues } from '../legal/evaluators'
import { sessionJurisdictionIssues } from '../rules/executable-constraints'
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
  const jurisdictionConstraintIssues = sessionJurisdictionIssues(session)
  const training = session.scenario.training

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
    ...jurisdictionConstraintIssues.map((issue) => issue.message),
    ...(training?.modeledPitfalls
      .filter((pitfall) => /jurisdiction|finality|rule 54|interlocutory/i.test(pitfall))
      .map((pitfall) => `Scenario pitfall supports a jurisdiction response: ${pitfall}`) ?? []),
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
    !filedEvents.has('docketing_statement') && filedEvents.has('notice_of_appeal')
      ? 'Ask the clerk to require a docketing statement before merits briefing proceeds.'
      : '',
    !filedEvents.has('transcript_order_acknowledgment') && filedEvents.has('notice_of_appeal')
      ? 'Raise record-ordering defects if appellant relies on transcripts or trial excerpts.'
      : '',
    ...(training?.modeledPitfalls
      .filter((pitfall) => /record|appendix|transcript|sealed|redaction|standard-of-review/i.test(pitfall))
      .map((pitfall) => `Use the scenario pitfall in procedural opposition: ${pitfall}`) ?? []),
    ...(training?.expectedProceduralPath
      .filter((eventId) => !filedEvents.has(eventId) && !['panel_deliberation', 'judgment_entered'].includes(eventId))
      .slice(0, 2)
      .map((eventId) => `Expected path not yet satisfied: ${eventId.replaceAll('_', ' ')}.`) ?? []),
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
