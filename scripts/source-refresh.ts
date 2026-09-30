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

import { createHash } from 'node:crypto'

import { ca4CourtSourceVersions } from '../src/domain/rules/ca4-source-profile'
import { normalizeSourceText } from '../src/domain/rules/source-governance'

function sha256(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

const maxSourceBytes = 5 * 1024 * 1024
const sourceFetchTimeoutMs = 15_000

const refreshed = []

for (const source of ca4CourtSourceVersions) {
  try {
    const response = await fetch(source.sourceUrl, {
      signal: AbortSignal.timeout(sourceFetchTimeoutMs),
    })
    const contentLength = Number(response.headers.get('content-length') ?? '0')
    if (!response.ok || contentLength > maxSourceBytes) {
      refreshed.push({
        sourceVersionId: source.sourceVersionId,
        label: source.label,
        sourceUrl: source.sourceUrl,
        status: response.status,
        error: contentLength > maxSourceBytes ? 'response too large' : response.statusText,
      })
      continue
    }
    const rawText = await response.text()
    if (rawText.length > maxSourceBytes) {
      refreshed.push({
        sourceVersionId: source.sourceVersionId,
        label: source.label,
        sourceUrl: source.sourceUrl,
        status: response.status,
        error: 'response too large',
      })
      continue
    }
    const contentHash = sha256(normalizeSourceText(rawText))
    refreshed.push({
      sourceVersionId: source.sourceVersionId,
      label: source.label,
      sourceUrl: source.sourceUrl,
      status: response.status,
      fetchedHash: contentHash,
      bundledHash: source.contentHash,
      changed: contentHash !== source.contentHash,
      bytes: rawText.length,
    })
  } catch (error) {
    refreshed.push({
      sourceVersionId: source.sourceVersionId,
      label: source.label,
      sourceUrl: source.sourceUrl,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

console.log(JSON.stringify(refreshed, null, 2))

const failures = refreshed.filter((source) => source.status < 200 || source.status >= 300)
if (failures.length) {
  console.error(`Unable to fetch ${failures.length} source(s).`)
  process.exit(1)
}
