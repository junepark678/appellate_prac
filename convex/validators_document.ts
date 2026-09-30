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

export const textExtractionStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('extracted'),
  v.literal('not_searchable'),
  v.literal('failed'),
  v.literal('fallback'),
)

export const documentSectionValidator = v.object({
  id: v.string(),
  label: v.string(),
  startIndex: v.number(),
  endIndex: v.optional(v.number()),
  textSnippet: v.string(),
})

export const documentAnalysisValidator = v.object({
  analyzerId: v.string(),
  pageCount: v.optional(v.number()),
  fileSizeBytes: v.number(),
  mimeType: v.string(),
  searchableText: v.boolean(),
  extractedPageText: v.optional(
    v.array(
      v.object({
        pageNumber: v.number(),
        text: v.string(),
      }),
    ),
  ),
  normalizedText: v.optional(v.string()),
  wordCount: v.optional(v.number()),
  sectionMap: v.optional(v.array(documentSectionValidator)),
  certificateOfServiceDetected: v.boolean(),
  certificateOfComplianceDetected: v.boolean(),
  certificateSnippets: v.optional(v.array(v.string())),
  legalCitations: v.optional(v.array(v.string())),
  recordCitations: v.optional(v.array(v.string())),
  appendixCitations: v.optional(v.array(v.string())),
  sealedOrRedactionWarning: v.boolean(),
  privacySealWarnings: v.optional(v.array(v.string())),
  textExtractionStatus: v.optional(textExtractionStatusValidator),
  extractionConfidence: v.optional(v.number()),
  warnings: v.array(v.string()),
})

export const documentAnalysisRecordValidator = v.object({
  id: v.string(),
  caseSessionId: v.string(),
  documentId: v.optional(v.string()),
  analysis: documentAnalysisValidator,
  createdAt: v.string(),
})

export const uploadedDocumentValidator = v.object({
  id: v.string(),
  fileName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  storageId: v.optional(v.string()),
  sha256: v.optional(v.string()),
  pageCount: v.optional(v.number()),
  extractedText: v.optional(v.string()),
  textExtractionStatus: v.optional(textExtractionStatusValidator),
  wordCount: v.optional(v.number()),
  analysisId: v.optional(v.string()),
  analysis: v.optional(documentAnalysisValidator),
  extractedSignals: v.array(v.string()),
})
