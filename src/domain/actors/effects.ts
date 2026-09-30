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
import { recommendAmicusParticipation } from '../amicus/workflow'
import { draftCounterpartyStrategy } from '../counterparty/strategy'
import { evaluateRelief } from '../legal/evaluators'
import {
  addBenchMemo,
  addPanelVote,
  assignPanel,
  createBenchMemo,
  createPanelDisposition,
  enterPanelDisposition,
  validatePanelDisposition,
  validatePanelVote,
} from '../panel/deliberation'
import { transitionAfterFiling } from '../procedure/state-machine'
import { submitEcfFiling } from '../filing/ecf'
import { isActorReasoningMemo, isGeneratedFilingDraft } from './schemas'
import { generatedFilingToSubmission } from './work-products'
import type {
  ActorReasoningMemo,
  ActorWorkProduct,
  AmicusCandidate,
  CaseSession,
  CounterpartyStrategy,
  EcfReceipt,
  PanelVote,
} from '../types'

export type ActorEffectResult = {
  session: CaseSession
  receipt?: EcfReceipt | null
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function voteFromRelief(relief: string): PanelVote['vote'] {
  const normalized = relief.toLowerCase().replaceAll('_', ' ')
  if (normalized.includes('vacate in part')) return 'vacate_in_part'
  if (normalized.includes('reverse')) return 'reverse'
  if (normalized.includes('vacate')) return 'vacate'
  if (normalized.includes('remand')) return 'remand'
  if (normalized.includes('dismiss')) return 'dismiss'
  return 'affirm'
}

function withAcceptedProduct(session: CaseSession, product: ActorWorkProduct): CaseSession {
  return {
    ...session,
    actorWorkProducts: session.actorWorkProducts?.map((candidate) =>
      candidate.id === product.id ? { ...candidate, status: 'accepted' as const } : candidate,
    ),
  }
}

function memoText(memo: ActorReasoningMemo) {
  return [
    memo.title,
    memo.summary,
    ...memo.reasoning,
    ...memo.recommendations,
    ...(memo.proceduralClaims ?? []),
    memo.requestedDisposition ?? '',
    memo.reliefOption ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

function strategyFromMemo(
  session: CaseSession,
  product: ActorWorkProduct,
  memo: ActorReasoningMemo,
): CounterpartyStrategy {
  const base = draftCounterpartyStrategy(session)
  const proceduralClaims = memo.proceduralClaims ?? []
  const recommendations = memo.recommendations.length ? memo.recommendations : memo.reasoning
  const text = memoText(memo)
  const recommendedNextFilingEventId =
    text.includes('motion') && !text.includes('appellee brief')
      ? 'motion'
      : base.recommendedNextFilingEventId

  return {
    ...base,
    id: `strategy_${product.id}`,
    forfeitureArguments: [
      ...base.forfeitureArguments,
      ...memo.reasoning.filter((item) => /forfeit|waiv|preserv/i.test(item)),
    ],
    jurisdictionArguments: [
      ...base.jurisdictionArguments,
      ...proceduralClaims.filter((item) => /jurisdiction|final|timely|deadline/i.test(item)),
    ],
    meritsArguments: [...base.meritsArguments, ...recommendations],
    proceduralMotions: [
      ...base.proceduralMotions,
      ...proceduralClaims.filter((item) => /motion|strike|dismiss|deficien|extend/i.test(item)),
    ],
    ...(recommendedNextFilingEventId ? { recommendedNextFilingEventId } : {}),
    updatedAt: product.createdAt,
  }
}

function amicusCandidateFromMemo(
  session: CaseSession,
  product: ActorWorkProduct,
  memo: ActorReasoningMemo,
): AmicusCandidate {
  const participation = recommendAmicusParticipation(session)
  const existing = participation.candidates.find((candidate) => candidate.recommended)
  const text = memoText(memo)
  const supportsRole = text.includes('appellee')
    ? 'appellee'
    : text.includes('neither')
      ? 'neither'
      : 'appellant'
  const consentStatus = text.includes('all parties consent') || text.includes('all-party consent')
    ? 'all_parties_consent'
    : text.includes('no consent')
      ? 'no_consent'
      : text.includes('partial consent')
        ? 'partial_consent'
        : existing?.consentStatus ?? 'unknown'

  return {
    id: existing?.id ?? (normalizeLabel(memo.title || product.actorId) || `amicus-${product.id}`),
    organizationName: existing?.organizationName ?? (memo.title || 'Public Interest Amicus'),
    organizationType: existing?.organizationType ?? 'public_interest',
    supportsRole,
    interestStatement:
      existing?.interestStatement ??
      memo.summary ??
      'The amicus has a distinct institutional interest in the appellate issue.',
    requiresLeave:
      consentStatus === 'all_parties_consent'
        ? false
        : existing?.requiresLeave ??
          !text.includes('notice under rule 29'),
    consentStatus,
    recommended: true,
    rationale: memo.recommendations[0] ?? memo.summary,
  }
}

function applyGeneratedFiling(session: CaseSession, product: ActorWorkProduct): ActorEffectResult {
  const submission = generatedFilingToSubmission(session, product)
  if (!submission) {
    throw new Error('Generated filing draft could not be converted to a CM/ECF submission.')
  }
  const result = submitEcfFiling(session, submission)
  if (!result.preflight.accepted) {
    throw new Error(
      result.preflight.issues.map((issue) => issue.message).join(' ') ||
        'Generated filing failed deterministic preflight.',
    )
  }
  return {
    session: transitionAfterFiling(result.session),
    receipt: result.receipt,
  }
}

function applyBenchMemo(session: CaseSession, product: ActorWorkProduct, memo: ActorReasoningMemo) {
  const assigned = session.panelAssignment ? session : assignPanel(session)
  const base = createBenchMemo(assigned)
  return addBenchMemo(assigned, {
    ...base,
    id: `bench_memo_${product.id}`,
    authorActorId: product.actorId,
    issueSummaries: memo.reasoning.length ? memo.reasoning : base.issueSummaries,
    recommendedDisposition:
      memo.reliefOption ?? memo.requestedDisposition ?? base.recommendedDisposition,
    risks: memo.proceduralClaims?.length ? memo.proceduralClaims : base.risks,
    createdAt: product.createdAt,
  })
}

function applyJudgeVote(session: CaseSession, product: ActorWorkProduct, memo: ActorReasoningMemo) {
  const assigned = session.panelAssignment ? session : assignPanel(session)
  const relief = memo.reliefOption ?? memo.requestedDisposition ?? evaluateRelief(assigned).availableRelief[0] ?? 'affirm'
  const vote: PanelVote = {
    id: `panel_vote_${String((assigned.panelDeliberation?.votes.length ?? 0) + 1).padStart(4, '0')}`,
    judgeActorId: product.actorId,
    vote: voteFromRelief(relief),
    reliefOption: relief,
    rationale: memo.summary || memo.reasoning.join(' '),
    joinsMajority: false,
    confidence: memo.confidence ?? 0.7,
    createdAt: product.createdAt,
  }
  const validation = validatePanelVote(assigned, vote)
  if (!validation.accepted) {
    throw new Error(validation.issues.join(' '))
  }
  return addPanelVote(assigned, vote)
}

function applyPanelDisposition(
  session: CaseSession,
  product: ActorWorkProduct,
  memo: ActorReasoningMemo,
) {
  const ruleRefsForDisposition = memo.ruleRefs.length
    ? memo.ruleRefs
    : [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41]
  const disposition = createPanelDisposition(
    session,
    memo.reliefOption ?? memo.requestedDisposition ?? undefined,
    memo.summary || memo.recommendations.join(' '),
    ruleRefsForDisposition,
  )
  const validation = validatePanelDisposition(session, disposition)
  if (!validation.accepted) {
    throw new Error(validation.issues.join(' '))
  }
  return enterPanelDisposition(session, {
    ...disposition,
    id: `panel_disposition_${product.id}`,
    createdAt: product.createdAt,
  })
}

function applyAssessment(
  session: CaseSession,
  memo: ActorReasoningMemo,
) {
  if (session.procedureState !== 'judgment_entered' && session.status !== 'closed') {
    throw new Error('Assessment feedback can only be accepted after judgment.')
  }
  return {
    ...session,
    assessment: {
      disposition:
        session.panelDisposition?.disposition ??
        memo.requestedDisposition ??
        session.assessment?.disposition ??
        'judgment entered',
      score:
        typeof memo.confidence === 'number'
          ? Math.round(memo.confidence * 100)
          : session.assessment?.score ?? 82,
      proceduralFindings: memo.proceduralClaims?.length
        ? memo.proceduralClaims
        : memo.reasoning,
      meritsFindings: memo.recommendations.length ? memo.recommendations : memo.reasoning,
      nextPracticeTargets: memo.recommendations.length
        ? memo.recommendations
        : ['Connect each procedural choice to a filing, record excerpt, docket entry, or rule reference.'],
    },
  }
}

export function applyAcceptedActorWorkProduct(
  session: CaseSession,
  product: ActorWorkProduct,
): ActorEffectResult {
  let result: ActorEffectResult

  if (product.kind === 'counterparty_filing_draft' || product.kind === 'amicus_filing_draft') {
    if (!isGeneratedFilingDraft(product.workProduct)) {
      throw new Error('Expected a generated filing draft.')
    }
    result = applyGeneratedFiling(session, product)
  } else {
    if (!isActorReasoningMemo(product.workProduct)) {
      throw new Error('Expected a reasoning memo work product.')
    }
    const memo = product.workProduct

    if (product.kind === 'counterparty_strategy') {
      result = {
        session: {
          ...session,
          counterpartyStrategy: strategyFromMemo(session, product, memo),
        },
      }
    } else if (product.kind === 'amicus_recommendation') {
      const participation = session.amicusParticipation ?? recommendAmicusParticipation(session)
      const candidate = amicusCandidateFromMemo(session, product, memo)
      result = {
        session: {
          ...session,
          amicusParticipation: {
            candidates: [
              candidate,
              ...participation.candidates.filter((existing) => existing.id !== candidate.id),
            ],
            acceptedBriefIds: participation.acceptedBriefIds,
            deniedCandidateIds: participation.deniedCandidateIds,
          },
        },
      }
    } else if (product.kind === 'bench_memo') {
      result = { session: applyBenchMemo(session, product, memo) }
    } else if (product.kind === 'judge_vote_memo') {
      result = { session: applyJudgeVote(session, product, memo) }
    } else if (product.kind === 'panel_disposition_draft') {
      result = { session: applyPanelDisposition(session, product, memo) }
    } else if (product.kind === 'assessment_feedback') {
      result = { session: applyAssessment(session, memo) }
    } else {
      throw new Error(`Unsupported actor work product kind: ${product.kind}`)
    }
  }

  return {
    ...result,
    session: withAcceptedProduct(result.session, product),
  }
}
