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

import type { CaseSession, ToolCall } from '../domain/types'
import { nextExpectedToolCall, validateToolCall } from '../domain/simulation'
import { getCourtPack } from '../domain/packs'
import {
  withTimeout,
  openRouterCircuitBreaker,
  DEGRADED_MODE_TEMPLATE,
  TimeoutError,
} from '../domain/ai-resilience'

export type OpenRouterConfig = {
  apiKey: string
  model: string
  appUrl?: string
  appTitle?: string
}

export type OpenRouterToolResult = {
  toolCall: ToolCall | null
  rawText: string
  degraded?: boolean
  degradedReason?: string
}

function toolSchema(actorIds: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['tool', 'actorId'],
    properties: {
      tool: {
        type: 'string',
        enum: [
          'issueClerkOrder',
          'setDeadline',
          'fileCounterpartyDocument',
          'submitToPanel',
          'issuePanelOrder',
          'disposeCase',
          'draftStaffMemo',
          'castRuntimePanelVote',
          'draftRuntimePanelDisposition',
          'enterJudgment',
          'setMandateDeadline',
        ],
      },
      actorId: actorIds.length
        ? { type: 'string', enum: actorIds }
        : { type: 'string' },
      title: { type: 'string' },
      text: { type: 'string' },
      label: { type: 'string' },
      targetEventId: { type: 'string' },
      offsetDays: { type: 'number' },
      eventId: { type: 'string' },
      disposition: { type: 'string' },
      issueSummaries: { type: 'array', items: { type: 'string' } },
      recommendedDisposition: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' } },
      vote: {
        type: 'string',
        enum: [
          'affirm',
          'reverse',
          'vacate',
          'vacate_in_part',
          'dismiss',
          'remand',
        ],
      },
      reliefOption: { type: 'string' },
      rationale: { type: 'string' },
      joinsMajority: { type: 'boolean' },
      separateWritingType: {
        type: 'string',
        enum: ['concurrence', 'dissent', 'concur_in_judgment'],
      },
      confidence: { type: 'number' },
      judgmentText: { type: 'string' },
      ruleRefs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ruleId', 'label', 'sourceUrl'],
          properties: {
            ruleId: { type: 'string' },
            label: { type: 'string' },
            sourceUrl: { type: 'string' },
          },
        },
      },
      sourceRuleRefs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ruleId', 'label', 'sourceUrl'],
          properties: {
            ruleId: { type: 'string' },
            label: { type: 'string' },
            sourceUrl: { type: 'string' },
          },
        },
      },
    },
  }
}

const OPENROUTER_TIMEOUT_MS = 30_000

export async function requestProceduralToolCall(
  session: CaseSession,
  config: OpenRouterConfig,
): Promise<OpenRouterToolResult> {
  if (!openRouterCircuitBreaker.canExecute()) {
    return {
      toolCall: null,
      rawText: DEGRADED_MODE_TEMPLATE,
      degraded: true,
      degradedReason: `Circuit breaker is ${openRouterCircuitBreaker.state}`,
    }
  }

  try {
    const courtPack = getCourtPack(session.courtPackId)
    const validAiActors = courtPack.aiActors.map((actor) => ({
      id: actor.id,
      label: actor.label,
      allowedTools: actor.allowedTools,
      authorityScope: actor.authorityScope,
    }))
    const recommendedToolCall = nextExpectedToolCall(session)
    const response = await withTimeout(
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          ...(config.appUrl ? { 'HTTP-Referer': config.appUrl } : {}),
          ...(config.appTitle ? { 'X-Title': config.appTitle } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a constrained court-simulator actor. Return one procedural tool call as JSON. Use only valid actor IDs and tools from the case state. If no stronger validated move is available, return recommendedToolCall exactly.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                recommendedToolCall,
                validAiActors,
                status: session.status,
                procedureState: session.procedureState,
                scenario: session.scenario,
                docketEntries: session.docketEntries.slice(-8),
                deadlines: session.deadlines,
                counterpartyStrategy: session.counterpartyStrategy,
                amicusParticipation: session.amicusParticipation,
                benchMemo: session.benchMemo,
                panelAssignment: session.panelAssignment,
                panelDeliberation: session.panelDeliberation,
                panelDisposition: session.panelDisposition,
                filings: session.filings.map((filing) => ({
                  eventId: filing.eventId,
                  outcome: filing.outcome,
                  issues: filing.validationIssues,
                })),
              }),
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'procedural_tool_call',
              strict: true,
              schema: toolSchema(validAiActors.map((actor) => actor.id)),
            },
          },
        }),
      }),
      OPENROUTER_TIMEOUT_MS,
      'OpenRouter',
    )

    if (!response.ok) {
      openRouterCircuitBreaker.recordFailure()
      throw new Error(`OpenRouter request failed: ${response.status}`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const rawText = payload.choices?.[0]?.message?.content ?? ''

    try {
      const parsed = JSON.parse(rawText) as {
        tool?: unknown
        actorId?: unknown
      }
      if (
        typeof parsed.tool !== 'string' ||
        typeof parsed.actorId !== 'string'
      ) {
        openRouterCircuitBreaker.recordSuccess()
        return { toolCall: null, rawText }
      }

      const validation = validateToolCall(
        session,
        parsed as { tool: string; actorId: string },
      )
      if (!validation.accepted) {
        openRouterCircuitBreaker.recordSuccess()
        return { toolCall: null, rawText }
      }

      openRouterCircuitBreaker.recordSuccess()
      return { toolCall: parsed as ToolCall, rawText }
    } catch {
      openRouterCircuitBreaker.recordSuccess()
      return { toolCall: null, rawText }
    }
  } catch (err) {
    openRouterCircuitBreaker.recordFailure()
    if (
      err instanceof TimeoutError ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      return {
        toolCall: null,
        rawText: DEGRADED_MODE_TEMPLATE,
        degraded: true,
        degradedReason: err.message,
      }
    }
    throw err
  }
}
