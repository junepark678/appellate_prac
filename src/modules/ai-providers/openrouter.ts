import type { AiProvider, StructuredAiRequest, StructuredAiResult } from '../types'

const openRouterTimeoutMs = 30_000

function timeoutSignal(ms: number) {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

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
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.config.appUrl ? { 'HTTP-Referer': this.config.appUrl } : {}),
        ...(this.config.appTitle ? { 'X-Title': this.config.appTitle } : {}),
      },
      signal: timeoutSignal(openRouterTimeoutMs),
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
    })

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status}`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const rawText = payload.choices?.[0]?.message?.content ?? ''

    try {
      const parsed = JSON.parse(rawText) as unknown
      if (request.validate && !request.validate(parsed)) {
        return { value: null, rawText, providerId: this.id }
      }
      return { value: parsed as T, rawText, providerId: this.id }
    } catch {
      return { value: null, rawText, providerId: this.id }
    }
  }
}
