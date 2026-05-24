import type { RuleRef } from '../types'

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
  ruleRefs: RuleRef[]
}

export const fourthCircuitCivilAppealSourceManifest: RuleSourceManifestItem[] = [
  {
    sourceVersionId: 'frap-2025-official-rulebook',
    moduleId: 'frap-2025',
    label: 'Federal Rules of Appellate Procedure',
    jurisdiction: 'US',
    version: '2025',
    effectiveFrom: '2025-12-01',
    sourceUrl: 'https://www.uscourts.gov/rules-policies/current-rules-practice-procedure',
    sourceSystem: 'uscourts',
    parserVersion: 'manual-v1',
    ruleRefs: [
      {
        ruleId: 'FRAP',
        label: 'Federal Rules of Appellate Procedure',
        sourceUrl: 'https://www.uscourts.gov/rules-policies/current-rules-practice-procedure',
      },
    ],
  },
  {
    sourceVersionId: 'ca4-local-rules-iop-2026-04',
    moduleId: 'ca4-local-rules-2026',
    label: 'Fourth Circuit Local Rules and Internal Operating Procedures',
    jurisdiction: 'US-CA4',
    version: '2026-04',
    effectiveFrom: '2026-04-01',
    sourceUrl: 'https://www.ca4.uscourts.gov/Rules/Rulebook_TOC.pdf',
    sourceSystem: 'court',
    parserVersion: 'manual-v1',
    ruleRefs: [
      {
        ruleId: 'CA4-LOCAL',
        label: 'Fourth Circuit Rules and IOPs',
        sourceUrl: 'https://www.ca4.uscourts.gov/Rules/Rulebook_TOC.pdf',
      },
    ],
  },
  {
    sourceVersionId: 'cm-ecf-us-courts-2026',
    moduleId: 'cm-ecf-federal-appellate',
    label: 'Federal CM/ECF and PACER Filing Reference',
    jurisdiction: 'US',
    version: '2026',
    effectiveFrom: '2026-01-01',
    sourceUrl: 'https://www.uscourts.gov/court-records/electronic-filing-cm-ecf',
    sourceSystem: 'uscourts',
    parserVersion: 'manual-v1',
    ruleRefs: [
      {
        ruleId: 'CM-ECF',
        label: 'CM/ECF Filing Reference',
        sourceUrl: 'https://www.uscourts.gov/court-records/electronic-filing-cm-ecf',
      },
    ],
  },
]

