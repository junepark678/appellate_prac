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

import { v } from 'convex/values'

export const participantRoleValidator = v.union(
  v.literal('appellant'),
  v.literal('appellee'),
  v.literal('petitioner'),
  v.literal('respondent'),
  v.literal('amicus'),
  v.literal('clerk'),
  v.literal('panel'),
  v.literal('district_court'),
  v.literal('plaintiff'),
  v.literal('defendant'),
  v.literal('judge'),
  v.literal('agency'),
)

export const caseStatusValidator = v.union(
  v.literal('setup'),
  v.literal('active'),
  v.literal('submitted'),
  v.literal('closed'),
  v.literal('dismissed'),
)

export const autonomyModeValidator = v.union(
  v.literal('paused'),
  v.literal('supervised'),
  v.literal('autonomous'),
)

export const turnPolicyValidator = v.object({
  maxTurnsPerRun: v.number(),
  requireHumanApprovalFor: v.array(v.string()),
  stopOnDeficiency: v.boolean(),
})

export const qualityStateValidator = v.union(
  v.literal('draft'),
  v.literal('source_review_pending'),
  v.literal('source_reviewed'),
  v.literal('eval_ready'),
  v.literal('beta_approved'),
  v.literal('production_approved'),
)

export const procedureStateValidator = v.union(
  v.literal('case_opened'),
  v.literal('notice_pending'),
  v.literal('jurisdiction_review'),
  v.literal('appearance_pending'),
  v.literal('fee_or_ifp_pending'),
  v.literal('record_pending'),
  v.literal('docketing_statement_pending'),
  v.literal('record_ordering_pending'),
  v.literal('briefing_schedule_pending'),
  v.literal('opening_brief_pending'),
  v.literal('appendix_pending'),
  v.literal('appellee_brief_pending'),
  v.literal('reply_brief_pending'),
  v.literal('motion_pending'),
  v.literal('submitted'),
  v.literal('panel_deliberation'),
  v.literal('judgment_entered'),
  v.literal('rehearing_pending'),
  v.literal('mandate_pending'),
  v.literal('closed'),
  v.literal('dismissed'),
)

export const filingOutcomeValidator = v.union(
  v.literal('accepted'),
  v.literal('accepted_with_deficiency'),
  v.literal('rejected'),
  v.literal('referred_to_panel'),
  v.literal('lodged_pending_review'),
)

export const deadlineStatusValidator = v.union(
  v.literal('open'),
  v.literal('satisfied'),
  v.literal('missed'),
  v.literal('vacated'),
)

export const ruleRefValidator = v.object({
  ruleId: v.string(),
  label: v.string(),
  sourceUrl: v.string(),
})

export const validationIssueValidator = v.object({
  severity: v.union(v.literal('error'), v.literal('warning'), v.literal('info')),
  message: v.string(),
  ruleRefs: v.array(ruleRefValidator),
  sourceVersionIds: v.optional(v.array(v.string())),
  code: v.optional(v.string()),
  cureSuggestion: v.optional(v.string()),
})
