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
