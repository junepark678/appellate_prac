import { ruleRefs } from '../../modules/registry'
import {
  evaluateDispositionOptions,
  evaluateIssues,
  evaluateRelief,
} from '../legal/evaluators'
import type {
  BenchMemo,
  CaseSession,
  PanelAssignment,
  PanelDeliberation,
  PanelDispositionRecord,
  PanelVote,
  PanelVotePosition,
  ReliefEvaluation,
  RuleRef,
  ToolValidationResult,
} from '../types'

export const ca4JudgeActorIds = ['ca4_judge_1', 'ca4_judge_2', 'ca4_judge_3'] as const

function makeId(prefix: string, count: number) {
  return `${prefix}_${String(count + 1).padStart(4, '0')}`
}

function activeFiledEventSet(session: CaseSession) {
  return new Set(
    session.filings
      .filter((filing) => filing.outcome !== 'rejected')
      .map((filing) => filing.eventId),
  )
}

function normalizedRelief(value: string) {
  return value.toLowerCase().replaceAll('_', ' ')
}

function voteFromRelief(relief: string): PanelVote['vote'] {
  if (relief.includes('vacate in part')) return 'vacate_in_part'
  if (relief.includes('vacate')) return 'vacate'
  if (relief.includes('remand')) return 'remand'
  if (relief.includes('reverse')) return 'reverse'
  if (relief.includes('dismiss')) return 'dismiss'
  return 'affirm'
}

function reliefForVote(vote: PanelVote['vote']) {
  if (vote === 'vacate_in_part') return 'vacate in part'
  return vote.replaceAll('_', ' ')
}

function majorityPosition(votes: PanelVote[]): PanelVotePosition | undefined {
  const counts = new Map<PanelVote['vote'], number>()
  for (const vote of votes) {
    counts.set(vote.vote, (counts.get(vote.vote) ?? 0) + 1)
  }

  for (const [vote, count] of counts.entries()) {
    if (count >= 2) return vote
  }
  return undefined
}

function majorityJudgeActorIds(votes: PanelVote[]) {
  const position = majorityPosition(votes)
  if (!position) return []
  return votes.filter((vote) => vote.vote === position).map((vote) => vote.judgeActorId)
}

function recommendedRelief(relief: ReliefEvaluation) {
  if (relief.availableRelief.includes('vacate in part')) return 'vacate in part'
  if (relief.availableRelief.includes('vacate')) return 'vacate'
  if (relief.availableRelief.includes('remand')) return 'remand'
  if (relief.availableRelief.includes('dismiss for lack of jurisdiction')) {
    return 'dismiss for lack of jurisdiction'
  }
  return 'affirm'
}

export function canSubmitToPanel(session: CaseSession): ToolValidationResult {
  const filedEvents = activeFiledEventSet(session)
  const issues: string[] = []

  for (const eventId of ['opening_brief', 'joint_appendix', 'appellee_brief', 'reply_brief']) {
    if (!filedEvents.has(eventId)) {
      issues.push(`Panel submission requires ${eventId.replaceAll('_', ' ')}.`)
    }
  }

  if (!['active', 'submitted'].includes(session.status)) {
    issues.push('Only active or submitted cases can enter panel deliberation.')
  }

  return { accepted: issues.length === 0, issues }
}

export function assignPanel(session: CaseSession): CaseSession {
  if (session.panelAssignment) return session

  const assignment: PanelAssignment = {
    id: makeId('panel_assignment', session.docketEntries.length),
    judgeActorIds: [...ca4JudgeActorIds],
    presidingJudgeActorId: ca4JudgeActorIds[0],
    assignedAt: session.simulatedDate,
    oralArgumentDisposition: 'submitted_on_briefs',
  }

  const panelDeliberation: PanelDeliberation = {
    id: makeId('panel_deliberation', session.docketEntries.length),
    caseSessionId: session.id,
    posture: 'screening',
    votes: [],
    mandateStatus: 'not_started',
  }

  return {
    ...session,
    panelAssignment: assignment,
    panelDeliberation,
  }
}

export function createBenchMemo(session: CaseSession): BenchMemo {
  const relief = evaluateRelief(session)
  const issues = evaluateIssues(session)
  const recommendedDisposition = recommendedRelief(relief)

  return {
    id: makeId('bench_memo', session.docketEntries.length),
    authorActorId: 'ca4_staff_attorney',
    issueSummaries: issues.map(
      (issue) =>
        `${issue.label}: ${issue.standardOfReview}; preservation ${issue.preservationStatus}; record support ${issue.recordSupport}.`,
    ),
    recommendedDisposition,
    reliefEvaluation: relief,
    risks: [
      ...issues
        .filter((issue) => issue.preservationStatus !== 'preserved')
        .map((issue) => `${issue.label} may be forfeited or underdeveloped.`),
      ...issues
        .filter((issue) => issue.recordSupport === 'missing')
        .map((issue) => `${issue.label} lacks appendix support.`),
    ],
    createdAt: session.simulatedDate,
  }
}

export function addBenchMemo(session: CaseSession, memo = createBenchMemo(session)): CaseSession {
  const deliberation = session.panelDeliberation ?? assignPanel(session).panelDeliberation

  return {
    ...session,
    benchMemo: memo,
    panelDeliberation: {
      ...(deliberation as PanelDeliberation),
      posture: 'voting',
      staffMemo: memo.issueSummaries.join('\n'),
      staffMemoRecord: memo,
    },
  }
}

export function nextPanelJudgeActorId(session: CaseSession) {
  const assignment = session.panelAssignment ?? assignPanel(session).panelAssignment
  const existingVotes = new Set(session.panelDeliberation?.votes.map((vote) => vote.judgeActorId))
  return assignment?.judgeActorIds.find((judgeId) => !existingVotes.has(judgeId))
}

export function deterministicPanelVote(
  session: CaseSession,
  judgeActorId: string,
): PanelVote {
  const relief = evaluateRelief(session)
  const options = evaluateDispositionOptions(session)
  const judgeIndex = ca4JudgeActorIds.findIndex((candidate) => candidate === judgeActorId)
  const recommended = recommendedRelief(relief)
  const preferredOption = options.find(
    (option) => option.available && normalizedRelief(option.relief) === normalizedRelief(recommended),
  )
  const fallbackOption = options.find((option) => option.available && option.position === 'affirm')
  const reliefOption = preferredOption?.relief ?? fallbackOption?.relief ?? 'affirm'
  const splitToAffirm = judgeIndex === 2 && reliefOption !== 'affirm' && relief.availableRelief.includes('affirm')
  const finalRelief = splitToAffirm ? 'affirm' : reliefOption
  const vote = voteFromRelief(finalRelief)

  return {
    id: makeId('panel_vote', session.panelDeliberation?.votes.length ?? 0),
    judgeActorId,
    vote,
    reliefOption: finalRelief,
    rationale: splitToAffirm
      ? 'The judge would affirm because any error is harmless or insufficiently supported by the appendix.'
      : `The judge follows the staff memo because available relief includes ${finalRelief}.`,
    joinsMajority: false,
    ...(splitToAffirm ? { separateWritingType: 'dissent' as const } : {}),
    confidence: splitToAffirm ? 0.64 : 0.78,
    createdAt: session.simulatedDate,
  }
}

export function validatePanelVote(session: CaseSession, vote: PanelVote): ToolValidationResult {
  const issues: string[] = []
  const relief = evaluateRelief(session)
  const assignment = session.panelAssignment

  if (!assignment?.judgeActorIds.includes(vote.judgeActorId)) {
    issues.push('Panel vote actor is not assigned to this panel.')
  }

  if (session.panelDeliberation?.votes.some((existing) => existing.judgeActorId === vote.judgeActorId)) {
    issues.push('Duplicate panel vote by the same judge.')
  }

  if (vote.confidence < 0 || vote.confidence > 1) {
    issues.push('Panel vote confidence must be between 0 and 1.')
  }

  if (!['submitted', 'panel_deliberation'].includes(session.procedureState ?? session.status)) {
    issues.push('Panel votes require submitted or panel-deliberation posture.')
  }

  const allowedRelief = new Set(relief.availableRelief.map(normalizedRelief))
  const voteRelief = normalizedRelief(vote.reliefOption || reliefForVote(vote.vote))
  if (!allowedRelief.has(voteRelief) && vote.vote !== 'affirm') {
    issues.push('Panel vote requests relief barred by the deterministic relief evaluation.')
  }

  return { accepted: issues.length === 0, issues }
}

export function addPanelVote(session: CaseSession, vote: PanelVote): CaseSession {
  const validation = validatePanelVote(session, vote)
  if (!validation.accepted) return session

  const deliberation = session.panelDeliberation ?? assignPanel(session).panelDeliberation
  const nextVotes = [...(deliberation?.votes ?? []), vote]
  const position = majorityPosition(nextVotes)

  return {
    ...session,
    panelDeliberation: {
      ...(deliberation as PanelDeliberation),
      posture: nextVotes.length >= 3 ? 'drafting' : 'voting',
      votes: nextVotes.map((candidate) => ({
        ...candidate,
        joinsMajority: position ? candidate.vote === position : candidate.joinsMajority,
      })),
      ...(position ? { majorityPosition: position } : {}),
    },
  }
}

export function validatePanelDisposition(
  session: CaseSession,
  disposition: Pick<PanelDispositionRecord, 'disposition' | 'judgmentText' | 'ruleRefs'>,
): ToolValidationResult {
  const issues: string[] = []
  const votes = session.panelDeliberation?.votes ?? []
  const majority = majorityPosition(votes)
  const relief = evaluateRelief(session)
  const ruleIds = new Set(disposition.ruleRefs.map((rule) => rule.ruleId))

  if (votes.length < 3) {
    issues.push('A panel disposition requires three valid judge votes.')
  }

  if (!majority || majorityJudgeActorIds(votes).length < 2) {
    issues.push('A panel disposition requires at least two votes supporting the result.')
  }

  if (!disposition.judgmentText.trim()) {
    issues.push('Panel disposition requires judgment text.')
  }

  const dispositionText = normalizedRelief(disposition.disposition)
  const allowedRelief = new Set(relief.availableRelief.map(normalizedRelief))
  if (
    !allowedRelief.has(dispositionText) &&
    !dispositionText.includes('opinion') &&
    !dispositionText.includes('judgment')
  ) {
    issues.push('Panel disposition contradicts the available relief evaluation.')
  }

  for (const requiredRule of [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41]) {
    if (!ruleIds.has(requiredRule.ruleId)) {
      issues.push(`Panel disposition must cite ${requiredRule.label}.`)
    }
  }

  return { accepted: issues.length === 0, issues }
}

export function createPanelDisposition(
  session: CaseSession,
  dispositionText?: string,
  judgmentText?: string,
  ruleRefsForDisposition: RuleRef[] = [ruleRefs.frap34, ruleRefs.frap36, ruleRefs.frap41],
): PanelDispositionRecord {
  const votes = session.panelDeliberation?.votes ?? []
  const majority = majorityPosition(votes) ?? 'affirm'
  const majorityJudges = majorityJudgeActorIds(votes)
  const relief = reliefForVote(majority === 'procedural_order' ? 'affirm' : majority)
  const separateOpinions = votes
    .filter((vote) => vote.separateWritingType && !majorityJudges.includes(vote.judgeActorId))
    .map((vote) => ({
      judgeActorId: vote.judgeActorId,
      type: vote.separateWritingType as NonNullable<PanelVote['separateWritingType']>,
      text: vote.rationale,
    }))

  return {
    id: makeId('panel_disposition', session.docketEntries.length),
    disposition: dispositionText ?? relief,
    judgmentText:
      judgmentText ??
      `Judgment entered: ${relief}. The mandate will issue under the simulated FRAP 41 schedule unless stayed.`,
    majorityJudgeActorIds: majorityJudges,
    separateOpinions,
    votes,
    ruleRefs: ruleRefsForDisposition,
    createdAt: session.simulatedDate,
  }
}

export function enterPanelDisposition(
  session: CaseSession,
  disposition = createPanelDisposition(session),
): CaseSession {
  const validation = validatePanelDisposition(session, disposition)
  if (!validation.accepted) return session

  const deliberation = session.panelDeliberation ?? assignPanel(session).panelDeliberation
  return {
    ...session,
    panelDisposition: disposition,
    panelDeliberation: {
      ...(deliberation as PanelDeliberation),
      posture: 'entered',
      dispositionText: disposition.disposition,
      judgmentText: disposition.judgmentText,
      mandateStatus: 'pending',
    },
  }
}
