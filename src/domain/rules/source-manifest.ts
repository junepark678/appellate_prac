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

import type { RuleRef } from '../types'
import { ca4CourtSourceVersions } from './ca4-source-profile'

export type RuleSourceManifestItem = {
  sourceVersionId: string
  moduleId: string
  label: string
  jurisdiction: string
  version: string
  effectiveFrom: string
  sourceUrl: string
  sourceSystem: 'court' | 'uscourts' | 'courtlistener' | 'recap' | 'manual'
  parserVersion: string
  contentHash?: string
  reviewStatus?: 'draft' | 'reviewed' | 'published' | 'rejected'
  ruleRefs: RuleRef[]
}

function moduleIdForSourceKind(sourceKind: RuleSourceManifestItem['sourceSystem'] | string) {
  if (sourceKind === 'frap') return 'frap-2025'
  if (sourceKind === 'cm_ecf_reference') return 'cm-ecf-federal-appellate'
  if (sourceKind === 'ecf_event_catalog') return 'ca4-ecf-event-catalog'
  if (sourceKind === 'ecf_local_rules') return 'ca4-ecf-local-rules'
  if (sourceKind === 'fee_schedule') return 'ca4-fee-schedule'
  if (sourceKind === 'forms') return 'ca4-forms'
  if (sourceKind === 'court_notices') return 'ca4-notices'
  return 'ca4-current'
}

export const fourthCircuitCivilAppealSourceManifest: RuleSourceManifestItem[] =
  ca4CourtSourceVersions.map((source) => ({
    sourceVersionId: source.sourceVersionId,
    moduleId: moduleIdForSourceKind(source.sourceKind ?? 'local_rules'),
    label: source.label,
    jurisdiction: source.sourceKind === 'frap' || source.sourceKind === 'cm_ecf_reference' ? 'US' : 'US-CA4',
    version: source.effectiveFrom,
    effectiveFrom: source.effectiveFrom,
    ...(source.effectiveTo ? { effectiveTo: source.effectiveTo } : {}),
    sourceUrl: source.sourceUrl,
    sourceSystem: source.sourceUrl.includes('uscourts.gov') && !source.sourceUrl.includes('ca4.')
      ? 'uscourts'
      : 'court',
    parserVersion: source.parserVersion ?? 'html-normalized-sha256-v1',
    contentHash: source.contentHash,
    reviewStatus: source.reviewStatus,
    ruleRefs: [
      {
        ruleId: source.sourceKind === 'frap' ? 'FRAP' : source.sourceKind === 'cm_ecf_reference' ? 'CM-ECF' : 'CA4-SOURCE',
        label: source.label,
        sourceUrl: source.sourceUrl,
      },
    ],
  }))
