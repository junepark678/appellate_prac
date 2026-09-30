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

import { assertReleaseGate, type EvalFreshnessSnapshot } from '../src/domain/rules/source-governance'

function parseEvalSnapshot(): EvalFreshnessSnapshot | undefined {
  const raw = process.env.SIMULATION_EVAL_SNAPSHOT_JSON
  if (!raw) return undefined
  const parsed = JSON.parse(raw) as EvalFreshnessSnapshot
  return parsed
}

const mode = process.argv.includes('--production') ? 'production' : 'beta'

try {
  const result = assertReleaseGate({
    mode,
    latestEval: parseEvalSnapshot(),
    env: process.env,
  })
  console.log(
    `Release gate passed for ${mode}: ${result.sourceStatuses.length} source versions checked.`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
