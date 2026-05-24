import { v } from 'convex/values'

import { mutation } from './_generated/server'
import { upsertCurrentUserDoc } from './authHelpers'

export const upsertCurrentUser = mutation({
  args: {},
  returns: v.object({
    id: v.string(),
    displayName: v.string(),
    role: v.union(v.literal('student'), v.literal('admin'), v.literal('instructor')),
    monthlyAiBudgetCents: v.number(),
  }),
  handler: async (ctx) => {
    const user = await upsertCurrentUserDoc(ctx)
    return {
      id: user._id,
      displayName: user.displayName,
      role: user.role,
      monthlyAiBudgetCents: user.monthlyAiBudgetCents,
    }
  },
})
