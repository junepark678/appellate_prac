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
import { ruleRefValidator } from './validators_core'
import { scenarioDocumentAssetValidator } from './validators_scenario'

export const toolCallValidator = v.union(
  v.object({
    tool: v.literal('issueClerkOrder'),
    actorId: v.string(),
    title: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('fileCounterpartyDocument'),
    actorId: v.string(),
    eventId: v.string(),
    title: v.string(),
    text: v.string(),
  }),
  v.object({
    tool: v.literal('setDeadline'),
    actorId: v.string(),
    label: v.string(),
    targetEventId: v.string(),
    offsetDays: v.number(),
    sourceRuleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('submitToPanel'),
    actorId: v.string(),
    text: v.string(),
  }),
  v.object({
    tool: v.literal('issuePanelOrder'),
    actorId: v.string(),
    title: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('disposeCase'),
    actorId: v.string(),
    disposition: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('draftStaffMemo'),
    actorId: v.string(),
    text: v.string(),
    issueSummaries: v.array(v.string()),
    recommendedDisposition: v.string(),
    risks: v.array(v.string()),
  }),
  v.object({
    tool: v.literal('castRuntimePanelVote'),
    actorId: v.string(),
    vote: v.union(
      v.literal('affirm'),
      v.literal('reverse'),
      v.literal('vacate'),
      v.literal('vacate_in_part'),
      v.literal('dismiss'),
      v.literal('remand'),
    ),
    reliefOption: v.string(),
    rationale: v.string(),
    joinsMajority: v.boolean(),
    separateWritingType: v.optional(
      v.union(
        v.literal('concurrence'),
        v.literal('dissent'),
        v.literal('concur_in_judgment'),
      ),
    ),
    confidence: v.number(),
  }),
  v.object({
    tool: v.literal('draftRuntimePanelDisposition'),
    actorId: v.string(),
    disposition: v.string(),
    text: v.string(),
    judgmentText: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('enterJudgment'),
    actorId: v.string(),
    disposition: v.string(),
    judgmentText: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('setMandateDeadline'),
    actorId: v.string(),
    label: v.string(),
    offsetDays: v.number(),
    sourceRuleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('recommendClerkAction'),
    actorId: v.string(),
    recommendation: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('draftClerkOrder'),
    actorId: v.string(),
    title: v.string(),
    text: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('draftCounterpartyFiling'),
    actorId: v.string(),
    eventId: v.string(),
    title: v.string(),
    text: v.string(),
  }),
  v.object({
    tool: v.literal('recommendAmicusParticipation'),
    actorId: v.string(),
    organizationType: v.string(),
    rationale: v.string(),
    requiresLeave: v.boolean(),
  }),
  v.object({
    tool: v.literal('draftBenchMemo'),
    actorId: v.string(),
    issueSummary: v.string(),
    recommendation: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('castPanelVote'),
    actorId: v.string(),
    vote: v.string(),
    reliefOption: v.string(),
    rationale: v.string(),
    confidence: v.number(),
  }),
  v.object({
    tool: v.literal('draftPanelDisposition'),
    actorId: v.string(),
    disposition: v.string(),
    text: v.string(),
    reliefOption: v.string(),
    ruleRefs: v.array(ruleRefValidator),
  }),
  v.object({
    tool: v.literal('draftAssessmentFeedback'),
    actorId: v.string(),
    proceduralFindings: v.array(v.string()),
    meritsFindings: v.array(v.string()),
    nextPracticeTargets: v.array(v.string()),
  }),
)

export const courtListenerSearchResultValidator = v.object({
  id: v.number(),
  absolute_url: v.optional(v.string()),
  caseName: v.optional(v.string()),
  caseNameFull: v.optional(v.string()),
  docket_id: v.optional(v.number()),
  docketNumber: v.optional(v.string()),
  court: v.optional(v.string()),
  court_id: v.optional(v.string()),
  dateFiled: v.optional(v.string()),
  more_docs: v.optional(v.boolean()),
  snippet: v.optional(v.string()),
})

export const trialDocketEntryValidator = v.object({
  id: v.string(),
  entryNumber: v.number(),
  filedAt: v.string(),
  title: v.string(),
  text: v.string(),
  documents: v.array(scenarioDocumentAssetValidator),
})

export const trialDocketValidator = v.object({
  caption: v.string(),
  court: v.string(),
  docketNumber: v.string(),
  sourceUrl: v.optional(v.string()),
  entries: v.array(trialDocketEntryValidator),
})
