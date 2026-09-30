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

import type { CourtPack } from '../../domain/types'
import type { CourtModule } from '../types'

export function courtModuleFromPack(pack: CourtPack): CourtModule {
  return {
    id: pack.moduleId ?? pack.id,
    label: pack.label,
    courtSystem: pack.courtSystem,
    courtLevel: pack.courtLevel,
    procedureDomains: [pack.procedureDomain],
    docketNumberFormat: pack.docketNumberFormat,
    rulePackIds: [...pack.includedRulePackIds, ...pack.rulePackIds],
    filingEventIds: pack.filingEvents.map((event) => event.id),
    actorProfileIds: pack.aiActors.map((actor) => actor.id),
    stateMachineIds: pack.procedureModuleIds ?? [],
  }
}
