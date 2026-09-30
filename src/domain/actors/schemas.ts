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

import type {
  ActorCitation,
  ActorReasoningMemo,
  ActorWorkProductKind,
  GeneratedFilingDraft,
  RuleRef,
} from '../types'

const ruleRefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ruleId', 'label', 'sourceUrl'],
  properties: {
    ruleId: { type: 'string' },
    label: { type: 'string' },
    sourceUrl: { type: 'string' },
  },
}

const citationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'sourceType'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    sourceType: {
      type: 'string',
      enum: ['filing', 'document_analysis', 'rule', 'record_excerpt', 'docket_entry'],
    },
    sourceId: { type: 'string' },
    ruleRef: ruleRefSchema,
    quote: { type: 'string' },
    pin: { type: 'string' },
  },
}

export const generatedFilingDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'eventId',
    'participantRole',
    'title',
    'documentFileName',
    'documentText',
    'certificateOfService',
    'certificateOfCompliance',
    'sealed',
    'notes',
    'citations',
    'ruleRefs',
  ],
  properties: {
    eventId: { type: 'string' },
    participantRole: {
      type: 'string',
      enum: ['appellant', 'appellee', 'petitioner', 'respondent', 'amicus', 'clerk', 'panel', 'district_court', 'plaintiff', 'defendant', 'judge', 'agency'],
    },
    title: { type: 'string' },
    documentFileName: { type: 'string' },
    documentText: { type: 'string' },
    attachmentTexts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'fileName', 'text', 'attachmentType'],
        properties: {
          label: { type: 'string' },
          fileName: { type: 'string' },
          text: { type: 'string' },
          attachmentType: {
            type: 'string',
            enum: ['main', 'appendix', 'exhibit', 'certificate', 'motion_attachment', 'other'],
          },
        },
      },
    },
    certificateOfService: { type: 'boolean' },
    certificateOfCompliance: { type: 'boolean' },
    sealed: { type: 'boolean' },
    notes: { type: 'string' },
    citations: { type: 'array', items: citationSchema },
    ruleRefs: { type: 'array', items: ruleRefSchema },
    recordRefs: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    roleAuthority: { type: 'string' },
  },
} as const

export const actorReasoningMemoSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'reasoning', 'recommendations', 'citations', 'ruleRefs'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    reasoning: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: citationSchema },
    ruleRefs: { type: 'array', items: ruleRefSchema },
    proceduralClaims: { type: 'array', items: { type: 'string' } },
    requestedDisposition: { type: 'string' },
    reliefOption: { type: 'string' },
    confidence: { type: 'number' },
    recordRefs: { type: 'array', items: { type: 'string' } },
    roleAuthority: { type: 'string' },
  },
} as const

export function schemaForWorkProductKind(kind: ActorWorkProductKind) {
  return ['counterparty_filing_draft', 'amicus_filing_draft'].includes(kind)
    ? generatedFilingDraftSchema
    : actorReasoningMemoSchema
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isRuleRef(value: unknown): value is RuleRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    isString((value as RuleRef).ruleId) &&
    isString((value as RuleRef).label) &&
    isString((value as RuleRef).sourceUrl)
  )
}

function isOptionalStringArray(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every(isString))
}

function isAttachmentTextArray(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (attachment) =>
          typeof attachment === 'object' &&
          attachment !== null &&
          isString((attachment as { label?: unknown }).label) &&
          isString((attachment as { fileName?: unknown }).fileName) &&
          isString((attachment as { text?: unknown }).text) &&
          ['main', 'appendix', 'exhibit', 'certificate', 'motion_attachment', 'other'].includes(
            (attachment as { attachmentType?: string }).attachmentType ?? '',
          ),
      ))
  )
}

function isCitation(value: unknown): value is ActorCitation {
  const candidate = value as ActorCitation
  return (
    typeof value === 'object' &&
    value !== null &&
    isString(candidate.id) &&
    isString(candidate.label) &&
    ['filing', 'document_analysis', 'rule', 'record_excerpt', 'docket_entry'].includes(
      candidate.sourceType,
    ) &&
    (!candidate.ruleRef || isRuleRef(candidate.ruleRef))
  )
}

export function isGeneratedFilingDraft(value: unknown): value is GeneratedFilingDraft {
  const candidate = value as GeneratedFilingDraft
  return (
    typeof value === 'object' &&
    value !== null &&
    isString(candidate.eventId) &&
    isString(candidate.participantRole) &&
    isString(candidate.title) &&
    isString(candidate.documentFileName) &&
    isString(candidate.documentText) &&
    typeof candidate.certificateOfService === 'boolean' &&
    typeof candidate.certificateOfCompliance === 'boolean' &&
    typeof candidate.sealed === 'boolean' &&
    isString(candidate.notes) &&
    Array.isArray(candidate.citations) &&
    candidate.citations.every(isCitation) &&
    Array.isArray(candidate.ruleRefs) &&
    candidate.ruleRefs.every(isRuleRef) &&
    isOptionalStringArray(candidate.recordRefs) &&
    (candidate.confidence === undefined ||
      (typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence))) &&
    (!candidate.roleAuthority || isString(candidate.roleAuthority)) &&
    isAttachmentTextArray(candidate.attachmentTexts)
  )
}

export function isActorReasoningMemo(value: unknown): value is ActorReasoningMemo {
  const candidate = value as ActorReasoningMemo
  return (
    typeof value === 'object' &&
    value !== null &&
    isString(candidate.title) &&
    isString(candidate.summary) &&
    Array.isArray(candidate.reasoning) &&
    candidate.reasoning.every(isString) &&
    Array.isArray(candidate.recommendations) &&
    candidate.recommendations.every(isString) &&
    Array.isArray(candidate.citations) &&
    candidate.citations.every(isCitation) &&
    Array.isArray(candidate.ruleRefs) &&
    candidate.ruleRefs.every(isRuleRef) &&
    isOptionalStringArray(candidate.proceduralClaims) &&
    (!candidate.requestedDisposition || isString(candidate.requestedDisposition)) &&
    (!candidate.reliefOption || isString(candidate.reliefOption)) &&
    isOptionalStringArray(candidate.recordRefs) &&
    (!candidate.roleAuthority || isString(candidate.roleAuthority)) &&
    (candidate.confidence === undefined ||
      (typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)))
  )
}

export function validateWorkProductPayload(
  kind: ActorWorkProductKind,
  value: unknown,
): value is GeneratedFilingDraft | ActorReasoningMemo {
  return ['counterparty_filing_draft', 'amicus_filing_draft'].includes(kind)
    ? isGeneratedFilingDraft(value)
    : isActorReasoningMemo(value)
}
