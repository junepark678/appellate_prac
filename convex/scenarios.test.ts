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

import { describe, expect, it } from 'vitest'

import { internal } from './_generated/api'
import scenarioSeed from '../src/domain/scenarios.seed.json'
import { convexTest } from 'convex-test'
import schema from './schema'

const scenarioModules = {
  './_generated/server.ts': () => import('./_generated/server'),
  './scenarios.ts': () => import('./scenarios'),
}

describe('seed scenario assets', () => {
  it('does not expose bundled synthetic trial-record PDFs as public static URLs', () => {
    for (const scenario of scenarioSeed) {
      for (const asset of scenario.documentAssets ?? []) {
        const assetWithLegacyUrls = asset as { fileUrl?: string; publicUrl?: string }
        expect(assetWithLegacyUrls.fileUrl).toBeUndefined()
        expect(assetWithLegacyUrls.publicUrl).toBeUndefined()
      }
    }
  })

  it('keeps bundled scenario publishing and PDF migration behind internal entrypoints', async () => {
    // convexTest uses only ephemeral in-memory database and storage state.
    const t = convexTest(schema, scenarioModules)
    const seeded = await t.mutation(internal.scenarios.seedPublished, {})
    expect(seeded.inserted + seeded.updated).toBeGreaterThan(0)

    const migrated = await t.action(
      internal.scenarios.migrateBundledScenarioPdfAssets,
      {},
    )
    expect(migrated.uploaded + migrated.skipped).toBeGreaterThan(0)
    const storedAssets = await t.run((ctx) =>
      ctx.db.query('scenarioDocumentAssets').collect(),
    )
    expect(storedAssets).toHaveLength(migrated.uploaded)
  })
})
