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
import { participantRoleValidator, filingOutcomeValidator, validationIssueValidator } from './validators_core'
import { uploadedDocumentValidator } from './validators_document'

export const filingAttachmentValidator = v.object({
  id: v.string(),
  label: v.string(),
  document: uploadedDocumentValidator,
  attachmentType: v.union(
    v.literal('main'),
    v.literal('appendix'),
    v.literal('exhibit'),
    v.literal('certificate'),
    v.literal('motion_attachment'),
    v.literal('other'),
  ),
})

export const filingMetadataValidator = v.object({
  filingAttorneyName: v.optional(v.string()),
  representedPartyId: v.optional(v.string()),
  representedPartyIds: v.optional(v.array(v.string())),
  selectedReliefs: v.optional(v.array(v.string())),
  feePaymentStatus: v.optional(
    v.union(
      v.literal('not_required'),
      v.literal('paid'),
      v.literal('deferred'),
      v.literal('waived'),
      v.literal('pending'),
    ),
  ),
  feeTransactionStub: v.optional(
    v.object({
      transactionId: v.string(),
      amountCents: v.number(),
      status: v.union(
        v.literal('simulated_paid'),
        v.literal('waived'),
        v.literal('deferred'),
        v.literal('pending'),
      ),
    }),
  ),
  reliefRequested: v.optional(v.string()),
  serviceMethod: v.union(
    v.literal('cm_ecf'),
    v.literal('mail'),
    v.literal('email'),
    v.literal('hand_delivery'),
    v.literal('none'),
  ),
  relatedDocketEntryId: v.optional(v.string()),
  relatedDocketEntryIds: v.optional(v.array(v.string())),
  serviceRecipientIds: v.optional(v.array(v.string())),
  consentStatus: v.optional(
    v.union(
      v.literal('all_parties_consent'),
      v.literal('partial_consent'),
      v.literal('no_consent'),
      v.literal('unknown'),
    ),
  ),
  sealedDocumentType: v.optional(v.string()),
  sealedAccessMode: v.optional(
    v.union(
      v.literal('public'),
      v.literal('sealed'),
      v.literal('court_only'),
      v.literal('selected_parties'),
    ),
  ),
  privacyAcknowledged: v.optional(v.boolean()),
  privacyReview: v.optional(
    v.object({
      completed: v.boolean(),
      reviewerRole: v.union(v.literal('learner'), v.literal('instructor'), v.literal('clerk_ai')),
      warnings: v.array(v.string()),
    }),
  ),
  publicRedactedVersionIncluded: v.optional(v.boolean()),
  redactedPublicVersionDocumentId: v.optional(v.string()),
  paperCopyRequirement: v.optional(
    v.object({
      required: v.boolean(),
      copies: v.number(),
      dueDate: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  ),
  serviceListOverrides: v.optional(
    v.object({
      additionalRecipients: v.optional(v.array(v.string())),
      suppressedParticipantIds: v.optional(v.array(v.string())),
      manualServiceRecipients: v.optional(v.array(v.string())),
    }),
  ),
  feeWaiverRequested: v.optional(v.boolean()),
  emergency: v.boolean(),
  sealed: v.boolean(),
  redactionAcknowledged: v.boolean(),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
})

export const filingSubmissionValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  filerPartyId: v.optional(v.string()),
  partyIds: v.optional(v.array(v.string())),
  title: v.string(),
  mainDocument: uploadedDocumentValidator,
  attachments: v.array(filingAttachmentValidator),
  metadata: filingMetadataValidator,
  notes: v.string(),
})

export const preflightCheckResultValidator = v.object({
  accepted: v.boolean(),
  outcome: filingOutcomeValidator,
  issues: v.array(validationIssueValidator),
  analyzedAt: v.string(),
})

export const filingDraftValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  title: v.string(),
  documents: v.array(uploadedDocumentValidator),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
  sealed: v.boolean(),
  notes: v.string(),
})

export const filingRecordValidator = v.object({
  eventId: v.string(),
  participantRole: participantRoleValidator,
  title: v.string(),
  documents: v.array(uploadedDocumentValidator),
  certificateOfService: v.boolean(),
  certificateOfCompliance: v.boolean(),
  sealed: v.boolean(),
  notes: v.string(),
  id: v.string(),
  filedAt: v.string(),
  outcome: filingOutcomeValidator,
  validationIssues: v.array(validationIssueValidator),
  submissionJson: v.optional(v.string()),
  documentAnalysisIds: v.optional(v.array(v.string())),
  filerPartyId: v.optional(v.string()),
  partyIds: v.optional(v.array(v.string())),
})
