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
