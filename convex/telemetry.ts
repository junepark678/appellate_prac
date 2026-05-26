import type { MutationCtx, QueryCtx } from './_generated/server'

// To enable Sentry, install @sentry/node and uncomment:
// import * as Sentry from '@sentry/node';
// Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.CONVEX_CLOUD_URL?.includes('dev') ? 'development' : 'production' });

export type TraceContext = {
  traceId: string
  spanId: string
  parentSpanId?: string
}

export function generateTraceId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function generateSpanId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function structLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  data?: Record<string, unknown>,
  trace?: TraceContext,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...trace,
    ...data,
  }
  const output = JSON.stringify(entry)
  switch (level) {
    case 'debug':
      console.debug(output)
      break
    case 'info':
      console.info(output)
      break
    case 'warn':
      console.warn(output)
      break
    case 'error':
      console.error(output)
      break
  }
}

export function logMutationStart(
  _ctx: MutationCtx | QueryCtx,
  mutationName: string,
): TraceContext {
  const traceId = generateTraceId()
  const spanId = generateSpanId()
  const trace: TraceContext = { traceId, spanId }
  structLog('info', 'mutation.start', { mutation: mutationName }, trace)
  return trace
}

export function logMutationEnd(
  _ctx: MutationCtx | QueryCtx,
  mutationName: string,
  durationMs: number,
): void {
  structLog('info', 'mutation.end', { mutation: mutationName, durationMs })
}

export function logError(
  _ctx: MutationCtx | QueryCtx,
  error: Error,
  mutationName: string,
): void {
  structLog('error', 'mutation.error', {
    mutation: mutationName,
    error: { name: error.name, message: error.message, stack: error.stack },
  })
  // Sentry.captureException(error, { tags: { mutation: mutationName } });
}

export function trackProviderCall(
  provider: string,
  latencyMs: number,
  success: boolean,
): void {
  structLog('info', 'provider.call', {
    provider,
    latencyMs,
    success,
  })
}
