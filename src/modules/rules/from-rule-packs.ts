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

import type { RulePack } from '../../domain/types'
import type {
  LegalSourceVersion,
  RuleConstraint,
  RuleModule,
} from '../types'

export function ruleModuleFromPack(pack: RulePack): RuleModule {
  const sourceVersion: LegalSourceVersion = {
    id: `${pack.id}:${pack.version}`,
    label: pack.label,
    jurisdiction: pack.items[0]?.jurisdiction ?? pack.courtSystem,
    version: pack.version,
    effectiveFrom: pack.items[0]?.effectiveFrom ?? pack.version,
    sourceUrl: pack.sourceUrl,
    sourceSystem: pack.sourceUrl.startsWith('https://www.uscourts.gov')
      ? 'uscourts'
      : pack.sourceUrl.startsWith('https://www.ca4.uscourts.gov')
        ? 'court'
        : 'manual',
    reviewed: true,
  }

  const constraints: RuleConstraint[] = pack.items.flatMap((item) =>
    item.structuredConstraints.map((constraint, index) => ({
      id: `${pack.id}:${item.ruleId}:${constraint.kind}:${index + 1}`,
      ruleId: item.ruleId,
      sourceVersionId: sourceVersion.id,
      topic: item.topic,
      kind: constraint.kind,
      value: constraint.value,
      ruleRefs: [
        {
          ruleId: item.ruleId,
          label: item.sourceLabel,
          sourceUrl: item.sourceUrl,
        },
      ],
    })),
  )

  return {
    id: pack.id,
    jurisdiction: sourceVersion.jurisdiction,
    version: pack.version,
    effectiveFrom: sourceVersion.effectiveFrom,
    sources: [sourceVersion],
    constraints,
    ruleItems: pack.items,
  }
}
