import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

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
  const sequence = await allocateCaseSessionEventSequence(ctx, caseSessionId)
  await ctx.db.insert('caseSessionEvents', {
    caseSessionId,
    sequence,
    eventType,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    ...(actorUserId ? { actorUserId } : {}),
  })
}
