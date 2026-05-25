import {
  courtPacks,
  filingEvents,
  getCourtPack as getRawCourtPack,
  getFilingEvent as getRawFilingEvent,
  getRuleItemsForCourt as getRawRuleItemsForCourt,
  getRulePacksForCourt as getRawRulePacksForCourt,
  getScenario as getRawScenario,
  criminalOpeningBriefDeadline,
  openingBriefDeadline,
  ruleRefs,
  rulePacks,
  scenarios,
} from '../domain/packs'
import { actorModuleFromActor } from './actors/from-domain-actors'
import { fourthCircuitCivilAppealAssessment } from './assessments/fourth-circuit-civil-appeal-rubric'
import { courtModuleFromPack } from './courts/from-court-packs'
import { pdfSignalAnalyzer } from './documents/pdf-signal-analyzer'
import { filingEventModuleFromEvent } from './filing-events/from-domain-events'
import { employmentCivilRightsSummaryJudgmentMerits } from './merits/employment-civil-rights-summary-judgment'
import { federalCivilAppealStandardBriefingProcedure } from './procedure/federal-civil-appeal-standard-briefing'
import { ruleModuleFromPack } from './rules/from-rule-packs'
import { implementedToolNames } from './tools'
import type { CaseSession, RuleItem } from '../domain/types'
import type {
  ActorModule,
  AvailableFilingEvent,
  CourtModule,
  FilingEventModule,
  RuleModule,
} from './types'

export { courtPacks, filingEvents, rulePacks, scenarios }
export { criminalOpeningBriefDeadline, openingBriefDeadline, ruleRefs }

export const ruleModules = rulePacks.map(ruleModuleFromPack)
export const filingEventModules = filingEvents.map(filingEventModuleFromEvent)
export const actorModules = courtPacks.flatMap((pack) =>
  pack.aiActors.map(actorModuleFromActor),
)
export const courtModules = courtPacks.map(courtModuleFromPack)
export const procedureModules = [federalCivilAppealStandardBriefingProcedure]
export const documentAnalyzers = [pdfSignalAnalyzer]
export const meritsModules = [employmentCivilRightsSummaryJudgmentMerits]
export const assessmentModules = [fourthCircuitCivilAppealAssessment]

export const moduleManifests = [
  ...courtModules.map((module) => ({
    moduleId: module.id,
    type: 'court',
    label: module.label,
    version: '0.1.0',
  })),
  ...ruleModules.map((module) => ({
    moduleId: module.id,
    type: 'rule',
    label: module.id,
    version: module.version,
  })),
  ...filingEventModules.map((module) => ({
    moduleId: module.id,
    type: 'filing-event',
    label: module.label,
    version: '0.1.0',
  })),
  ...actorModules.map((module) => ({
    moduleId: module.id,
    type: 'actor',
    label: module.label,
    version: '0.1.0',
  })),
  ...procedureModules.map((module) => ({
    moduleId: module.id,
    type: 'procedure',
    label: module.id,
    version: '0.1.0',
  })),
] as const

const ruleModuleById = new Map(ruleModules.map((module) => [module.id, module]))
const filingEventModuleById = new Map(
  filingEventModules.map((module) => [module.id, module]),
)
const actorModuleById = new Map(actorModules.map((module) => [module.id, module]))
const courtModuleById = new Map(courtModules.map((module) => [module.id, module]))
const procedureModuleById = new Map(
  procedureModules.map((module) => [module.id, module]),
)

export function getCourtPack(courtPackId: string) {
  return getRawCourtPack(courtPackId)
}

export function getRulePacksForCourt(courtPackId: string) {
  return getRawRulePacksForCourt(courtPackId)
}

export function getRuleItemsForCourt(courtPackId: string): RuleItem[] {
  return getRawRuleItemsForCourt(courtPackId)
}

export function getFilingEvent(courtPackId: string, eventId: string) {
  return getRawFilingEvent(courtPackId, eventId)
}

export function getScenario(scenarioId: string) {
  return getRawScenario(scenarioId)
}

export function getCourtModule(courtModuleId: string): CourtModule {
  const courtModule = courtModuleById.get(courtModuleId)
  if (!courtModule) {
    throw new Error(`Unknown court module: ${courtModuleId}`)
  }
  return courtModule
}

export function getRuleModule(ruleModuleId: string): RuleModule {
  const ruleModule = ruleModuleById.get(ruleModuleId)
  if (!ruleModule) {
    throw new Error(`Unknown rule module: ${ruleModuleId}`)
  }
  return ruleModule
}

export function getFilingEventModule(eventId: string): FilingEventModule {
  const eventModule = filingEventModuleById.get(eventId)
  if (!eventModule) {
    throw new Error(`Unknown filing event module: ${eventId}`)
  }
  return eventModule
}

export function getActorModule(actorId: string): ActorModule {
  const actorModule = actorModuleById.get(actorId)
  if (!actorModule) {
    throw new Error(`Unknown actor module: ${actorId}`)
  }
  return actorModule
}

export function getAvailableFilingEvents(session: CaseSession): AvailableFilingEvent[] {
  const courtPack = getCourtPack(session.courtPackId)
  const procedureModuleId = courtPack.procedureModuleIds?.[0]
  if (!procedureModuleId) return []

  const procedureModule = procedureModuleById.get(procedureModuleId)
  const courtEventIds = new Set(courtPack.filingEvents.map((event) => event.id))
  return procedureModule?.availableEvents(session).filter((event) => courtEventIds.has(event.eventId)) ?? []
}

export function validateModuleRegistry(): string[] {
  const errors: string[] = []
  const ruleIds = new Set(ruleModules.flatMap((module) => module.ruleItems.map((item) => item.ruleId)))
  const filingEventIds = new Set(filingEventModules.map((module) => module.id))
  const actorIds = new Set(actorModules.map((module) => module.id))
  const procedureIds = new Set(procedureModules.map((module) => module.id))

  for (const court of courtModules) {
    for (const rulePackId of court.rulePackIds) {
      if (!ruleModuleById.has(rulePackId)) {
        errors.push(`${court.id} references unknown rule module ${rulePackId}.`)
      }
    }
    for (const eventId of court.filingEventIds) {
      if (!filingEventIds.has(eventId)) {
        errors.push(`${court.id} references unknown filing event module ${eventId}.`)
      }
    }
    for (const actorId of court.actorProfileIds) {
      if (!actorIds.has(actorId)) {
        errors.push(`${court.id} references unknown actor module ${actorId}.`)
      }
    }
    for (const stateMachineId of court.stateMachineIds) {
      if (!procedureIds.has(stateMachineId)) {
        errors.push(`${court.id} references unknown procedure module ${stateMachineId}.`)
      }
    }
  }

  for (const event of filingEventModules) {
    for (const constraint of event.constraints) {
      if (!ruleIds.has(constraint)) {
        errors.push(`${event.id} references unknown rule constraint source ${constraint}.`)
      }
    }
  }

  for (const actor of actorModules) {
    for (const tool of actor.allowedTools) {
      if (!implementedToolNames.has(tool)) {
        errors.push(`${actor.id} references unimplemented AI tool ${tool}.`)
      }
    }
  }

  for (const procedure of procedureModules) {
    for (const transition of procedure.transitions) {
      if (transition.filingEventId && !filingEventIds.has(transition.filingEventId)) {
        errors.push(
          `${procedure.id} transition ${transition.id} references unknown filing event ${transition.filingEventId}.`,
        )
      }
      if (transition.actorToolName && !implementedToolNames.has(transition.actorToolName)) {
        errors.push(
          `${procedure.id} transition ${transition.id} references unimplemented AI tool ${transition.actorToolName}.`,
        )
      }
    }
  }

  return errors
}
