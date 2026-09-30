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

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export type CircuitBreakerConfig = {
  failureThreshold: number
  resetTimeoutMs: number
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30000,
}

export class CircuitBreaker {
  private _state: CircuitState = CircuitState.CLOSED
  private failureCount = 0
  private lastFailureTime = 0
  private readonly config: CircuitBreakerConfig

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config }
  }

  get state(): CircuitState {
    if (this._state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime
      if (elapsed >= this.config.resetTimeoutMs) {
        this._state = CircuitState.HALF_OPEN
      }
    }
    return this._state
  }

  canExecute(): boolean {
    return this.state !== CircuitState.OPEN
  }

  recordSuccess(): void {
    this.failureCount = 0
    this._state = CircuitState.CLOSED
  }

  recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()
    if (this.failureCount >= this.config.failureThreshold) {
      this._state = CircuitState.OPEN
    }
  }
}

export type DegradedModeResult<T> = {
  value: T | null
  degraded: boolean
  reason: string
}

export const DEGRADED_MODE_TEMPLATE =
  'AI provider unavailable. Filing simulation proceeding in degraded mode.'

export const openRouterCircuitBreaker = new CircuitBreaker()
