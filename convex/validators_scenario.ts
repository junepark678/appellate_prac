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
import { participantRoleValidator } from './validators_core'

export const scenarioRecordExcerptValidator = v.object({
  id: v.string(),
  label: v.string(),
  source: v.union(v.literal('synthetic'), v.literal('courtlistener'), v.literal('uploaded')),
  text: v.string(),
  citedByIssueIds: v.array(v.string()),
})

export const scenarioIssueValidator = v.object({
  id: v.string(),
  label: v.string(),
  standardOfReview: v.string(),
  preservationFacts: v.array(v.string()),
  recordSupportFacts: v.array(v.string()),
  likelyArgumentsForAppellant: v.array(v.string()),
  likelyArgumentsForAppellee: v.array(v.string()),
  possibleRelief: v.array(v.string()),
})

export const scenarioTrainingMetadataValidator = v.object({
  difficulty: v.union(
    v.literal('intro'),
    v.literal('intermediate'),
    v.literal('advanced'),
  ),
  practiceFocus: v.array(
    v.union(
      v.literal('jurisdiction'),
      v.literal('case_opening'),
      v.literal('motions'),
      v.literal('briefing'),
      v.literal('record_appendix'),
      v.literal('amicus'),
      v.literal('panel_merits'),
      v.literal('post_judgment'),
      v.literal('sealed_materials'),
    ),
  ),
  learningObjectives: v.array(v.string()),
  modeledPitfalls: v.array(v.string()),
  expectedProceduralPath: v.array(v.string()),
  likelyAmici: v.optional(
    v.array(
      v.object({
        organizationName: v.string(),
        organizationType: v.string(),
        supportsRole: v.union(
          v.literal('appellant'),
          v.literal('appellee'),
          v.literal('neither'),
        ),
        triggerIssueIds: v.array(v.string()),
        interestStatement: v.string(),
        requiresLeave: v.boolean(),
      }),
    ),
  ),
})

export const participantValidator = v.object({
  id: v.string(),
  displayName: v.string(),
  role: participantRoleValidator,
})

export const scenarioDocumentAssetValidator = v.object({
  id: v.string(),
  label: v.string(),
  fileName: v.string(),
  mimeType: v.literal('application/pdf'),
  source: v.union(
    v.literal('synthetic'),
    v.literal('courtlistener'),
    v.literal('uploaded'),
  ),
  fileUrl: v.optional(v.string()),
  publicUrl: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  storageId: v.optional(v.string()),
  sha256: v.optional(v.string()),
  sizeBytes: v.number(),
  pageCount: v.number(),
  extractedText: v.optional(v.string()),
})

export const scenarioTrialDocketEntryValidator = v.object({
  id: v.string(),
  entryNumber: v.number(),
  filedAt: v.string(),
  title: v.string(),
  text: v.string(),
  documentAssetIds: v.array(v.string()),
})

export const scenarioTrialDocketValidator = v.object({
  caption: v.string(),
  court: v.string(),
  docketNumber: v.string(),
  sourceUrl: v.optional(v.string()),
  entries: v.array(scenarioTrialDocketEntryValidator),
})

export const scenarioValidator = v.object({
  id: v.string(),
  visibility: v.optional(v.union(v.literal('public_template'), v.literal('private'))),
  ownerUserId: v.optional(v.string()),
  scenarioFamilyKey: v.optional(v.string()),
  revision: v.optional(v.number()),
  revisionStatus: v.optional(
    v.union(v.literal('draft'), v.literal('published'), v.literal('archived')),
  ),
  createdFromScenarioId: v.optional(v.string()),
  supersededByScenarioId: v.optional(v.string()),
  title: v.string(),
  source: v.union(
    v.literal('synthetic'),
    v.literal('recap_import'),
    v.literal('generated_from_import'),
  ),
  courtPackId: v.string(),
  shortCaption: v.string(),
  lowerTribunal: v.string(),
  natureOfSuit: v.string(),
  proceduralPosture: v.string(),
  issuesPresented: v.array(v.string()),
  meritsRecord: v.array(v.string()),
  issues: v.optional(v.array(scenarioIssueValidator)),
  recordExcerpts: v.optional(v.array(scenarioRecordExcerptValidator)),
  training: v.optional(scenarioTrainingMetadataValidator),
  participants: v.optional(v.array(participantValidator)),
  sourceCaseUrl: v.optional(v.string()),
  trialDocket: v.optional(scenarioTrialDocketValidator),
  documentAssets: v.optional(v.array(scenarioDocumentAssetValidator)),
})
