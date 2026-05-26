import type { AiProvider, StructuredAiRequest, StructuredAiResult } from '../types'
import {
  withTimeout,
  openRouterCircuitBreaker,
  DEGRADED_MODE_TEMPLATE,
  TimeoutError,
} from '../../domain/ai-resilience'

const OPENROUTER_TIMEOUT_MS = 30_000

export class OpenRouterProvider implements AiProvider {
  id = 'openrouter'

  constructor(
    private readonly config: {
      apiKey: string
      model: string
      appUrl?: string
      appTitle?: string
    },
  ) {}

  async completeStructured<T>(
    request: StructuredAiRequest<T>,
  ): Promise<StructuredAiResult<T>> {
    if (!openRouterCircuitBreaker.canExecute()) {
      return { value: null, rawText: DEGRADED_MODE_TEMPLATE, providerId: this.id }
    }

    try {
      const response = await withTimeout(
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            ...(this.config.appUrl ? { 'HTTP-Referer': this.config.appUrl } : {}),
            ...(this.config.appTitle ? { 'X-Title': this.config.appTitle } : {}),
          },
          body: JSON.stringify({
            model: request.model ?? this.config.model,
            messages: request.messages,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: request.schema,
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
        const parsed = JSON.parse(rawText) as unknown
        if (request.validate && !request.validate(parsed)) {
          openRouterCircuitBreaker.recordSuccess()
          return { value: null, rawText, providerId: this.id }
        }
        openRouterCircuitBreaker.recordSuccess()
        return { value: parsed as T, rawText, providerId: this.id }
      } catch {
        openRouterCircuitBreaker.recordSuccess()
        return { value: null, rawText, providerId: this.id }
      }
    } catch (err) {
      openRouterCircuitBreaker.recordFailure()
      if (err instanceof TimeoutError) {
        return { value: null, rawText: DEGRADED_MODE_TEMPLATE, providerId: this.id }
      }
      throw err
    }
  }
}
