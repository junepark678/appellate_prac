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

import { ruleRefs } from '../packs'
import { scenarioIssues } from '../legal/evaluators'
import type {
  AmicusCandidate,
  AmicusParticipation,
  CaseSession,
  FilingSubmission,
  ValidationIssue,
} from '../types'

function activeFilings(session: CaseSession) {
  return session.filings.filter((filing) => filing.outcome !== 'rejected')
}

function activeFiledEventSet(session: CaseSession) {
  return new Set(activeFilings(session).map((filing) => filing.eventId))
}

function hasBroadLegalSignificance(session: CaseSession) {
  const text = [
    session.scenario.natureOfSuit,
    session.scenario.proceduralPosture,
    ...scenarioIssues(session).map((issue) => issue.label),
  ]
    .join(' ')
    .toLowerCase()

  return [
    'civil rights',
    'employment',
    'summary judgment',
    'standard',
    'constitutional',
    'public',
    'agency',
  ].some((signal) => text.includes(signal))
}

function candidateId(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function explicitScenarioAmici(session: CaseSession): AmicusCandidate[] {
  const amici = session.scenario.training?.likelyAmici ?? []
  if (!amici.length) return []
  const issueLabels = new Map(scenarioIssues(session).map((issue) => [issue.id, issue.label]))

  return amici.map((amicus) => {
    const triggeredLabels = amicus.triggerIssueIds
      .map((issueId) => issueLabels.get(issueId) ?? issueId)
      .join(', ')
    return {
      id: candidateId(amicus.organizationName),
      organizationName: amicus.organizationName,
      organizationType: amicus.organizationType as AmicusCandidate['organizationType'],
      supportsRole: amicus.supportsRole,
      interestStatement: amicus.interestStatement,
      requiresLeave: amicus.requiresLeave,
      consentStatus: 'unknown',
      recommended: true,
      rationale: triggeredLabels
        ? `Scenario metadata identifies amicus interest tied to: ${triggeredLabels}.`
        : 'Scenario metadata identifies a likely amicus interest.',
    }
  })
}

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
): ValidationIssue {
  return {
    severity,
    code,
    message,
    ruleRefs: [ruleRefs.frap29],
    cureSuggestion:
      severity === 'error'
        ? 'Use the amicus notice/consent or motion-for-leave workflow before tendering the brief.'
        : 'Confirm consent, timing, and distinct amicus interest before filing.',
  }
}

export function recommendAmicusParticipation(session: CaseSession): AmicusParticipation {
  const filedEvents = activeFiledEventSet(session)
  if (!filedEvents.has('opening_brief')) {
    return {
      candidates: [],
      acceptedBriefIds: session.amicusParticipation?.acceptedBriefIds ?? [],
      deniedCandidateIds: session.amicusParticipation?.deniedCandidateIds ?? [],
    }
  }

  const explicitCandidates = explicitScenarioAmici(session)
  if (explicitCandidates.length) {
    return {
      candidates: explicitCandidates,
      acceptedBriefIds: session.amicusParticipation?.acceptedBriefIds ?? [],
      deniedCandidateIds: session.amicusParticipation?.deniedCandidateIds ?? [],
    }
  }

  if (!hasBroadLegalSignificance(session)) {
    return {
      candidates: [],
      acceptedBriefIds: session.amicusParticipation?.acceptedBriefIds ?? [],
      deniedCandidateIds: session.amicusParticipation?.deniedCandidateIds ?? [],
    }
  }

  const candidates: AmicusCandidate[] = [
    {
      id: 'civil-rights-appellate-center',
      organizationName: 'Civil Rights Appellate Center',
      organizationType: 'civil_rights_group',
      supportsRole: 'appellant',
      interestStatement:
        'The proposed amicus can address summary judgment treatment of comparator evidence across employment-retaliation cases.',
      requiresLeave: true,
      consentStatus: 'unknown',
      recommended: true,
      rationale:
        'The appeal presents a recurring civil-rights summary judgment issue beyond the parties.',
    },
  ]

  return {
    candidates,
    acceptedBriefIds: session.amicusParticipation?.acceptedBriefIds ?? [],
    deniedCandidateIds: session.amicusParticipation?.deniedCandidateIds ?? [],
  }
}

export function withAmicusRecommendations(session: CaseSession): CaseSession {
  const participation = recommendAmicusParticipation(session)
  if (!participation.candidates.length && !session.amicusParticipation) return session
  return {
    ...session,
    amicusParticipation: participation,
  }
}

export function validateAmicusSubmission(
  session: CaseSession,
  submission: FilingSubmission,
): ValidationIssue[] {
  if (
    ![
      'amicus_notice_or_consent',
      'motion_for_leave_to_file_amicus',
      'amicus_brief',
      'response_to_amicus_motion',
    ].includes(submission.eventId)
  ) {
    return []
  }

  const filedEvents = activeFiledEventSet(session)
  const participation = session.amicusParticipation ?? recommendAmicusParticipation(session)
  const approvedCandidate = participation.candidates.find((candidate) => candidate.recommended)
  const issues: ValidationIssue[] = []

  if (!approvedCandidate) {
    issues.push(
      issue(
        'error',
        'amicus_not_contextually_supported',
        'No amicus participation is currently justified by the scenario and filing posture.',
      ),
    )
  }

  if (!filedEvents.has('opening_brief')) {
    issues.push(
      issue(
        'error',
        'amicus_before_opening_brief',
        'Amicus participation is not evaluated until after the opening brief is accepted.',
      ),
    )
  }

  if (
    submission.eventId === 'amicus_brief' &&
    approvedCandidate?.requiresLeave &&
    submission.metadata.consentStatus !== 'all_parties_consent' &&
    !filedEvents.has('motion_for_leave_to_file_amicus')
  ) {
    issues.push(
      issue(
        'error',
        'amicus_leave_required',
        'Amicus brief requires all-party consent or a motion for leave before it can be accepted.',
      ),
    )
  }

  const allText = [
    submission.mainDocument.fileName,
    submission.mainDocument.extractedText ?? '',
    ...submission.mainDocument.extractedSignals,
  ]
    .join(' ')
    .toLowerCase()

  if (submission.eventId === 'amicus_brief' && !allText.includes('interest')) {
    issues.push(
      issue(
        'warning',
        'amicus_interest_statement_missing',
        'The amicus brief does not show a distinct interest statement signal.',
      ),
    )
  }

  return issues
}

export function updateAmicusAfterAcceptedFiling(session: CaseSession): CaseSession {
  const participation = session.amicusParticipation ?? recommendAmicusParticipation(session)
  if (!participation.candidates.length) return session

  const acceptedAmicusBriefs = activeFilings(session)
    .filter((filing) => filing.eventId === 'amicus_brief')
    .map((filing) => filing.id)

  return {
    ...session,
    amicusParticipation: {
      ...participation,
      acceptedBriefIds: [...new Set([...participation.acceptedBriefIds, ...acceptedAmicusBriefs])],
    },
  }
}
