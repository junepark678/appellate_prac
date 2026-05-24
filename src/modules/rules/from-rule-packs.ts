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
