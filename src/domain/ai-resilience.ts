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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutError(label, ms)), ms),
      ),
    ])
  } finally {
    clearTimeout(timer)
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
