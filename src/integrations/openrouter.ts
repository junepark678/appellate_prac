import type { CaseSession, ToolCall } from '../domain/types'
import { validateToolCall } from '../domain/simulation'
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

const toolSchema = {
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
    actorId: { type: 'string' },
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
      enum: ['affirm', 'reverse', 'vacate', 'vacate_in_part', 'dismiss', 'remand'],
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
                'You are a constrained court-simulator actor. Return one procedural tool call as JSON. Do not invent authority outside the case state.',
            },
            {
              role: 'user',
              content: JSON.stringify({
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
              schema: toolSchema,
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
      const parsed = JSON.parse(rawText) as { tool?: unknown; actorId?: unknown }
      if (typeof parsed.tool !== 'string' || typeof parsed.actorId !== 'string') {
        openRouterCircuitBreaker.recordSuccess()
        return { toolCall: null, rawText }
      }

      const validation = validateToolCall(session, parsed as { tool: string; actorId: string })
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
    if (err instanceof TimeoutError) {
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
