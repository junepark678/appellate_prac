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
  DispositionOption,
  IssueEvaluation,
  PreservationEvaluation,
  RecordSupportEvaluation,
  ReliefEvaluation,
  ScenarioIssue,
  ScenarioRecordExcerpt,
  UploadedDocument,
} from '../types'

function activeFilings(session: CaseSession) {
  return session.filings.filter((filing) => filing.outcome !== 'rejected')
}

function activeFiledEventSet(session: CaseSession) {
  return new Set(activeFilings(session).map((filing) => filing.eventId))
}

function scenarioText(session: CaseSession) {
  return [
    session.scenario.id,
    session.scenario.proceduralPosture,
    ...session.scenario.issuesPresented,
    ...(session.scenario.training?.modeledPitfalls ?? []),
    ...(session.scenario.issues?.map((issue) => `${issue.id} ${issue.label}`) ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

function hasFinalityTrap(session: CaseSession) {
  const text = scenarioText(session)
  if (!text.includes('rule 54') && !text.includes('partial judgment')) return false
  return !session.docketEntries.some((entry) =>
    /rule 54\(b\)|final judgment|certification/i.test(`${entry.title} ${entry.text}`),
  )
}

function hasQualifiedImmunityLimitedJurisdiction(session: CaseSession) {
  const text = scenarioText(session)
  return text.includes('qualified immunity') && text.includes('legal questions')
}

function allDocumentsForEvent(session: CaseSession, eventId: string): UploadedDocument[] {
  return activeFilings(session)
    .filter((filing) => filing.eventId === eventId)
    .flatMap((filing) => filing.documents)
}

function textForDocuments(documents: UploadedDocument[]) {
  return documents
    .flatMap((document) => [
      document.fileName,
      document.extractedText ?? '',
      ...document.extractedSignals,
    ])
    .join(' ')
    .toLowerCase()
}

function containsAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value.toLowerCase()))
}

function normalizeIssueId(label: string, index: number) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 52) || `issue-${index + 1}`
  )
}

export function scenarioIssues(session: CaseSession): ScenarioIssue[] {
  if (session.scenario.issues?.length) return session.scenario.issues

  return session.scenario.issuesPresented.map((label, index) => ({
    id: normalizeIssueId(label, index),
    label,
    standardOfReview: label.toLowerCase().includes('evidentiary')
      ? 'abuse of discretion or forfeiture-sensitive review'
      : 'de novo',
    preservationFacts: ['Derived from the legacy issues-presented field.'],
    recordSupportFacts: session.scenario.meritsRecord,
    likelyArgumentsForAppellant: [label],
    likelyArgumentsForAppellee: ['Appellee argues the judgment should be affirmed.'],
    possibleRelief: ['affirm', 'vacate', 'remand'],
  }))
}

export function scenarioRecordExcerpts(session: CaseSession): ScenarioRecordExcerpt[] {
  if (session.scenario.recordExcerpts?.length) return session.scenario.recordExcerpts

  return session.scenario.meritsRecord.map((text, index) => ({
    id: `legacy-record-${index + 1}`,
    label: `Record excerpt ${index + 1}`,
    source: 'synthetic',
    text,
    citedByIssueIds: scenarioIssues(session).map((issue) => issue.id),
  }))
}

function issueRaisedInOpeningBrief(issue: ScenarioIssue, openingText: string) {
  const fragments = [
    issue.id.replaceAll('-', ' '),
    issue.label,
    ...issue.likelyArgumentsForAppellant,
  ]
  return containsAny(openingText, fragments) || openingText.includes('statement of issues')
}

function issueRaisedFirstInReply(session: CaseSession, issue: ScenarioIssue) {
  const openingText = textForDocuments(allDocumentsForEvent(session, 'opening_brief'))
  const replyText = textForDocuments(allDocumentsForEvent(session, 'reply_brief'))
  if (!replyText) return false
  return !issueRaisedInOpeningBrief(issue, openingText) && containsAny(replyText, [
    issue.id.replaceAll('-', ' '),
    issue.label,
    ...issue.likelyArgumentsForAppellant,
  ])
}

export function evaluateIssues(session: CaseSession): IssueEvaluation[] {
  const filedEvents = activeFiledEventSet(session)
  const openingText = textForDocuments(allDocumentsForEvent(session, 'opening_brief'))
  const appendixText = textForDocuments(allDocumentsForEvent(session, 'joint_appendix'))
  const hasOpeningBrief = filedEvents.has('opening_brief')
  const hasAppendix = filedEvents.has('joint_appendix')

  return scenarioIssues(session).map((issue) => {
    const raisedInOpening = hasOpeningBrief && issueRaisedInOpeningBrief(issue, openingText)
    const raisedInReply = issueRaisedFirstInReply(session, issue)
    const hasRecordSignal =
      hasAppendix &&
      (appendixText.includes('appendix') ||
        containsAny(appendixText, [
          issue.id.replaceAll('-', ' '),
          ...issue.recordSupportFacts,
          ...scenarioRecordExcerpts(session)
            .filter((excerpt) => excerpt.citedByIssueIds.includes(issue.id))
            .map((excerpt) => excerpt.label),
        ]))

    const preservationStatus: IssueEvaluation['preservationStatus'] = !hasOpeningBrief
      ? 'forfeited'
      : raisedInOpening
        ? 'preserved'
        : raisedInReply
          ? 'forfeited'
          : 'unclear'

    const recordSupport: IssueEvaluation['recordSupport'] = !hasAppendix
      ? 'missing'
      : hasRecordSignal
        ? issue.id.includes('evidentiary')
          ? 'mixed'
          : 'strong'
        : 'weak'

    return {
      issueId: issue.id,
      label: issue.label,
      standardOfReview: issue.standardOfReview,
      preservationStatus,
      waiverOrForfeitureRisk:
        preservationStatus === 'preserved'
          ? 'low'
          : preservationStatus === 'unclear'
            ? 'medium'
            : 'high',
      recordSupport,
      harmlessErrorPosture:
        recordSupport === 'missing' || issue.id.includes('evidentiary')
          ? 'harmless_likely'
          : 'prejudicial_possible',
      requestedRelief: issue.possibleRelief,
    }
  })
}

export function evaluatePreservation(session: CaseSession): PreservationEvaluation[] {
  return evaluateIssues(session).map((issue) => ({
    issueId: issue.issueId,
    status: issue.preservationStatus,
    risk: issue.waiverOrForfeitureRisk,
    reasons:
      issue.preservationStatus === 'preserved'
        ? ['The issue appears in the opening-brief record for simulator purposes.']
        : issue.preservationStatus === 'forfeited'
          ? ['The issue is missing from the opening brief or appears first in reply.']
          : ['The filing signals do not clearly preserve the issue.'],
  }))
}

export function evaluateRecordSupport(session: CaseSession): RecordSupportEvaluation[] {
  const excerpts = scenarioRecordExcerpts(session)
  return evaluateIssues(session).map((issue) => ({
    issueId: issue.issueId,
    support: issue.recordSupport,
    missingExcerpts:
      issue.recordSupport === 'strong'
        ? []
        : excerpts
            .filter((excerpt) => excerpt.citedByIssueIds.includes(issue.issueId))
            .map((excerpt) => excerpt.label),
    reasons:
      issue.recordSupport === 'missing'
        ? ['The joint appendix is not on file.']
        : issue.recordSupport === 'weak'
          ? ['The appendix is on file, but it does not contain a strong issue-specific signal.']
          : ['Record support is available in the current simulator record.'],
  }))
}

export function evaluateRelief(session: CaseSession): ReliefEvaluation {
  const issues = evaluateIssues(session)
  const preservedRecordIssue = issues.some(
    (issue) =>
      issue.preservationStatus === 'preserved' &&
      ['strong', 'mixed'].includes(issue.recordSupport),
  )
  const jurisdictionDefect = !activeFiledEventSet(session).has('notice_of_appeal')
  const finalityTrap = hasFinalityTrap(session)

  if (session.status === 'dismissed' || session.procedureState === 'dismissed') {
    return {
      availableRelief: ['dismiss for default', 'dismiss for lack of jurisdiction'],
      barredRelief: ['vacate', 'reverse', 'remand'],
      reasons: ['The case is in a dismissal posture, so merits relief is unavailable.'],
    }
  }

  if (jurisdictionDefect) {
    return {
      availableRelief: ['affirm', 'dismiss for lack of jurisdiction'],
      barredRelief: ['reverse', 'vacate', 'remand'],
      reasons: ['Merits relief is unavailable until the notice of appeal path is satisfied.'],
    }
  }

  if (finalityTrap) {
    return {
      availableRelief: ['dismiss for lack of jurisdiction'],
      barredRelief: ['affirm', 'reverse', 'vacate', 'vacate in part', 'remand'],
      reasons: [
        'The scenario presents a partial judgment without a final judgment or Rule 54(b) certification.',
      ],
    }
  }

  if (hasQualifiedImmunityLimitedJurisdiction(session)) {
    const preservedLegalQuestion = issues.some(
      (issue) =>
        issue.issueId.includes('legal-question') &&
        issue.preservationStatus === 'preserved',
    )
    return {
      availableRelief: preservedLegalQuestion
        ? ['affirm', 'dismiss for lack of jurisdiction', 'remand']
        : ['affirm', 'dismiss for lack of jurisdiction'],
      barredRelief: ['reverse', 'vacate in part', 'fact-bound reversal'],
      reasons: [
        'Qualified-immunity interlocutory review is limited to legal questions and does not allow ordinary fact-bound merits relief.',
      ],
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

export function evaluateDispositionOptions(session: CaseSession): DispositionOption[] {
  const relief = evaluateRelief(session)
  const available = new Set(relief.availableRelief.map((value) => value.toLowerCase()))

  return [
    {
      position: 'affirm',
      relief: 'affirm',
      available: available.has('affirm'),
      reasons: available.has('affirm')
        ? ['Affirmance is available when jurisdiction and merits posture permit it.']
        : relief.reasons,
    },
    { position: 'vacate', relief: 'vacate', available: available.has('vacate'), reasons: relief.reasons },
    { position: 'vacate_in_part', relief: 'vacate in part', available: available.has('vacate in part'), reasons: relief.reasons },
    { position: 'remand', relief: 'remand', available: available.has('remand'), reasons: relief.reasons },
    { position: 'reverse', relief: 'reverse', available: available.has('reverse'), reasons: relief.reasons },
    {
      position: 'dismiss',
      relief: 'dismiss for lack of jurisdiction',
      available: available.has('dismiss for lack of jurisdiction'),
      reasons: relief.reasons,
    },
  ]
}

export function filingLegalDefects(session: CaseSession, eventId: string) {
  const issues = evaluateIssues(session)
  const defects: string[] = []

  if (eventId === 'opening_brief') {
    const openingText = textForDocuments(allDocumentsForEvent(session, 'opening_brief'))
    if (!openingText.includes('standard of review')) {
      defects.push('missing standard of review')
    }
    if (!openingText.includes('record citation')) {
      defects.push('missing record citations')
    }
  }

  if (eventId === 'reply_brief') {
    const firstInReply = scenarioIssues(session).filter((issue) =>
      issueRaisedFirstInReply(session, issue),
    )
    defects.push(...firstInReply.map((issue) => `${issue.label} raised first in reply`))
  }

  if (eventId === 'joint_appendix') {
    defects.push(
      ...issues
        .filter((issue) => issue.recordSupport === 'missing')
        .map((issue) => `${issue.label} lacks appendix support`),
    )
  }

  return defects
}
