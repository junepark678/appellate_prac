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

import scenarioSeed from '../src/domain/scenarios.seed.json'

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
})
