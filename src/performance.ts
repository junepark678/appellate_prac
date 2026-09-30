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

import { log } from './telemetry'

export type PerformanceMetric = {
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  delta: number
  navigationType?: string
  timestamp: number
}

const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
  TTFB: { good: 800, poor: 1800 },
} as const

type MetricName = keyof typeof THRESHOLDS

function getRating(name: MetricName, value: number): PerformanceMetric['rating'] {
  const threshold = THRESHOLDS[name]
  if (value <= threshold.good) return 'good'
  if (value <= threshold.poor) return 'needs-improvement'
  return 'poor'
}

const ENTRY_TYPE_MAP: Record<string, MetricName> = {
  'largest-contentful-paint': 'LCP',
  'first-input': 'FID',
  'layout-shift': 'CLS',
  'event': 'INP',
  'navigation': 'TTFB',
}

type OnMetricCallback = (metric: PerformanceMetric) => void

export function observeWebVitals(onMetric: OnMetricCallback): () => void {
  if (typeof PerformanceObserver === 'undefined') {
    return () => {}
  }

  const supportedTypes: string[] = []
  const requiredTypes: string[] = [
    'largest-contentful-paint',
    'first-input',
    'layout-shift',
    'event',
    'navigation',
  ]

  for (const type of requiredTypes) {
    if (PerformanceObserver.supportedEntryTypes.includes(type)) {
      supportedTypes.push(type)
    }
  }

  if (supportedTypes.length === 0) {
    return () => {}
  }

  let prevValues: Partial<Record<MetricName, number>> = {}

  const handleEntries = (list: PerformanceObserverEntryList) => {
    for (const entry of list.getEntries()) {
      const metricName = ENTRY_TYPE_MAP[entry.entryType]
      if (!metricName) continue

      let value: number
      switch (entry.entryType) {
        case 'largest-contentful-paint':
          value = entry.startTime
          break
        case 'first-input':
          value = (entry as PerformanceEventTiming).processingStart - entry.startTime
          break
        case 'layout-shift':
          if ((entry as LayoutShift).hadRecentInput) continue
          value = (entry as LayoutShift).value
          break
        case 'event': {
          const evt = entry as PerformanceEventTiming
          if (!evt.interactionId) continue
          value = evt.duration
          break
        }
        case 'navigation':
          value = (entry as PerformanceNavigationTiming).responseStart
          break
        default:
          continue
      }

      const prev = prevValues[metricName] ?? 0
      const delta = value - prev
      prevValues[metricName] = value

      const navigationType = (entry as PerformanceNavigationTiming & { navigationType?: string }).navigationType

      onMetric({
        name: metricName,
        value,
        rating: getRating(metricName, value),
        delta,
        navigationType,
        timestamp: Date.now(),
      })
    }
  }

  const observers: PerformanceObserver[] = []

  try {
    for (let i = 0; i < supportedTypes.length; i++) {
      const obs = new PerformanceObserver(handleEntries)
      observers.push(obs)
      obs.observe({ type: supportedTypes[i], buffered: true })
    }
  } catch {
    for (const obs of observers) {
      obs.disconnect()
    }
    return () => {}
  }

  return () => {
    for (const obs of observers) {
      obs.disconnect()
    }
  }
}

export function reportMetric(metric: PerformanceMetric): void {
  if (import.meta.env.DEV) {
    console.log(
      `[Performance] ${metric.name}: ${metric.value.toFixed(2)} (${metric.rating})`,
    )
  }

  log('info', 'performance_metric', {
    metric_name: metric.name,
    metric_value: metric.value,
    metric_rating: metric.rating,
    metric_delta: metric.delta,
    navigation_type: metric.navigationType,
    metric_timestamp: metric.timestamp,
  })

  // if (import.meta.env.PROD) {
  //   fetch('/api/v1/metrics', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify(metric),
  //     keepalive: true,
  //   }).catch(() => {})
  // }
}

export function measureBundleLoad(): void {
  if (typeof performance === 'undefined') return

  const measure = () => {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    if (!nav) return

    const value = nav.loadEventEnd - nav.startTime
    if (value <= 0) return

    reportMetric({
      name: 'bundle_load',
      value,
      rating: value <= 3000 ? 'good' : value <= 6000 ? 'needs-improvement' : 'poor',
      delta: value,
      navigationType: (nav as PerformanceNavigationTiming & { navigationType?: string }).navigationType,
      timestamp: Date.now(),
    })
  }

  if (document.readyState === 'complete') {
    setTimeout(measure, 0)
  } else {
    window.addEventListener('load', () => setTimeout(measure, 0))
  }
}

export async function measureApiLatency<T>(
  label: string,
  promise: Promise<T>,
): Promise<T> {
  const start = performance.now()
  try {
    const result = await promise
    const value = performance.now() - start
    reportMetric({
      name: `api_latency_${label}`,
      value,
      rating: value <= 500 ? 'good' : value <= 2000 ? 'needs-improvement' : 'poor',
      delta: value,
      timestamp: Date.now(),
    })
    return result
  } catch (error) {
    const value = performance.now() - start
    reportMetric({
      name: `api_latency_${label}`,
      value,
      rating: 'poor',
      delta: value,
      timestamp: Date.now(),
    })
    throw error
  }
}

export function initPerformanceMonitoring(): () => void {
  const disconnect = observeWebVitals(reportMetric)
  measureBundleLoad()
  return disconnect
}

interface LayoutShift extends PerformanceEntry {
  value: number
  hadRecentInput: boolean
}

interface PerformanceEventTiming extends PerformanceEntry {
  processingStart: number
  interactionId: number | undefined
  duration: number
}
