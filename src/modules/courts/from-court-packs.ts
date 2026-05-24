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
