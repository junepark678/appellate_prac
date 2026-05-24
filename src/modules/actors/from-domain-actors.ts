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
