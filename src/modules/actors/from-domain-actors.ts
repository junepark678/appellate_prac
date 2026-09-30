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

import type { AiActor } from '../../domain/types'
import type { ActorModule } from '../types'

export function actorModuleFromActor(actor: AiActor): ActorModule {
  return {
    id: actor.id,
    role: actor.role,
    label: actor.label,
    authorityScope: actor.authorityScope,
    allowedTools: actor.allowedTools,
    promptProfileId: `${actor.id}:default`,
    strategyPolicyId:
      actor.role === 'opposing_party' ? 'appellee-standard-defense' : undefined,
  }
}
