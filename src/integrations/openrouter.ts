import type { CaseSession, ToolCall } from '../domain/types'
import { validateToolCall } from '../domain/simulation'

export type OpenRouterConfig = {
  apiKey: string
  model: string
  appUrl?: string
  appTitle?: string
}

export type OpenRouterToolResult = {
  toolCall: ToolCall | null
  rawText: string
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

export async function requestProceduralToolCall(
  session: CaseSession,
  config: OpenRouterConfig,
): Promise<OpenRouterToolResult> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
  })

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const rawText = payload.choices?.[0]?.message?.content ?? ''

  try {
    const parsed = JSON.parse(rawText) as { tool?: unknown; actorId?: unknown }
    if (typeof parsed.tool !== 'string' || typeof parsed.actorId !== 'string') {
      return { toolCall: null, rawText }
    }

    const validation = validateToolCall(session, parsed as { tool: string; actorId: string })
    if (!validation.accepted) {
      return { toolCall: null, rawText }
    }

    return { toolCall: parsed as ToolCall, rawText }
  } catch {
    return { toolCall: null, rawText }
  }
}
