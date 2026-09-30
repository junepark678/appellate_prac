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

// To enable Sentry on the frontend, install @sentry/react and uncomment:
// import * as Sentry from '@sentry/react';
// Sentry.init({
//   dsn: import.meta.env.VITE_SENTRY_DSN,
//   environment: import.meta.env.MODE,
//   integrations: [Sentry.browserTracingIntegration()],
//   tracesSampleRate: 1.0,
// });

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function reportError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  // Sentry.captureException(error, { extra: context });
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'unhandled_error',
      error: { name: error.name, message: error.message, stack: error.stack },
      ...context,
    }),
  )
}

export function reportAiProviderError(
  provider: string,
  error: Error,
): void {
  reportError(error, {
    ai_provider: provider,
    event: 'ai_provider_error',
  })
}

export function trackWebVital(metric: {
  name: string
  value: number
  rating: string
}): void {
  log('info', 'web_vital', {
    metric_name: metric.name,
    metric_value: metric.value,
    metric_rating: metric.rating,
  })
  // Sentry.addBreadcrumb({ category: 'web-vital', message: metric.name, level: 'info', data: metric });
}

export function log(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
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
