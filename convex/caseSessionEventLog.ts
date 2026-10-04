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

import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { requireCurrentUser } from './authHelpers'
import { requireInstitutionRole } from './authz'
import { AppErrorCode, ConvexError, notFound, sessionLocked } from './errors'
import { isOrganizationMembershipActive } from './organizationContracts'

async function allocateCaseSessionEventSequence(
  ctx: MutationCtx,
  caseSessionId: Id<'caseSessions'>,
) {
  const caseSession = await ctx.db.get(caseSessionId)
  if (!caseSession) {
    // ERROR_CODE: NOT_FOUND
    throw new Error('Case session not found')
  }

  let sequence = caseSession.nextEventSequence
  if (typeof sequence !== 'number') {
    const latestEvent = await ctx.db
      .query('caseSessionEvents')
      .withIndex('by_case_sequence', (index) =>
        index.eq('caseSessionId', caseSessionId),
      )
      .order('desc')
      .first()
    sequence = (latestEvent?.sequence ?? 0) + 1
  }

  await ctx.db.patch(caseSessionId, { nextEventSequence: sequence + 1 })
  return sequence
}

export async function appendCaseSessionEvent(
  ctx: MutationCtx,
  caseSessionId: Id<'caseSessions'>,
  eventType: string,
  payload: Record<string, unknown>,
  actorUserId?: Id<'users'>,
) {
  const { user } = await requireCurrentUser(ctx)
  const session = await ctx.db.get(caseSessionId)
  if (
    !session ||
    !session.institutionId ||
    (actorUserId !== undefined && actorUserId !== user._id)
  ) {
    throw notFound('Case session')
  }
  const { institution, membership } = await requireInstitutionRole(
    ctx,
    session.institutionId,
    ['learner'],
  )
  const isOwner = session.userId === user._id
  const instructorReview =
    !isOwner &&
    eventType === 'instructor_review_submitted' &&
    membership.role !== 'learner' &&
    typeof payload.assignmentSessionId === 'string'

  if (!isOwner && !instructorReview) throw notFound('Case session')

  if (!isOwner) {
    const ownerMemberships = await ctx.db
      .query('institutionMemberships')
      .withIndex('by_institution_user', (index) =>
        index
          .eq('institutionId', institution._id)
          .eq('userId', session.userId),
      )
      .take(2)
    if (ownerMemberships.length > 1) {
      throw new ConvexError(AppErrorCode.CONFLICT, 'Organization membership is ambiguous')
    }
    if (!isOrganizationMembershipActive(institution, ownerMemberships[0] ?? null, Date.now())) {
      throw notFound('Case session')
    }
    const assignmentSessions = await ctx.db
      .query('assignmentSessions')
      .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
      .take(2)
    const exactReviewSession = assignmentSessions.find(
      (assignmentSession) =>
        assignmentSession._id === payload.assignmentSessionId &&
        assignmentSession.userId === session.userId,
    )
    const assignment = exactReviewSession
      ? await ctx.db.get(exactReviewSession.assignmentId)
      : null
    const cohort = assignment ? await ctx.db.get(assignment.cohortId) : null
    if (
      !exactReviewSession ||
      !assignment ||
      !cohort ||
      assignment.scenarioId !== session.scenarioId ||
      cohort.institutionId !== session.institutionId
    ) {
      throw notFound('Case session')
    }
  }

  const assignmentSessions = await ctx.db
    .query('assignmentSessions')
    .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
    .take(2)
  if (
    isOwner &&
    assignmentSessions.some(
      (assignmentSession) =>
        assignmentSession.submittedAt &&
        (!assignmentSession.reopenedAt ||
          assignmentSession.reopenedAt <= assignmentSession.submittedAt),
    )
  ) {
    throw sessionLocked()
  }
  const sequence = await allocateCaseSessionEventSequence(ctx, caseSessionId)
  await ctx.db.insert('caseSessionEvents', {
    caseSessionId,
    sequence,
    eventType,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    actorUserId: user._id,
  })
}
