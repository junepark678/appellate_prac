import type { AiToolName } from './types'

export const implementedToolNames = new Set<AiToolName>([
  'issueClerkOrder',
  'fileCounterpartyDocument',
  'setDeadline',
  'submitToPanel',
  'issuePanelOrder',
  'disposeCase',
  'draftStaffMemo',
  'castRuntimePanelVote',
  'draftRuntimePanelDisposition',
  'enterJudgment',
  'setMandateDeadline',
  'recommendClerkAction',
  'draftClerkOrder',
  'analyzeAppellantFiling',
  'draftCounterpartyStrategy',
  'fileResponsiveMotion',
  'fileAppelleeBrief',
  'opposeMotion',
  'respondToRehearing',
  'draftCounterpartyFiling',
  'recommendAmicusParticipation',
  'draftBenchMemo',
  'castPanelVote',
  'draftPanelDisposition',
  'draftAssessmentFeedback',
])

export function isImplementedAiTool(tool: string): tool is AiToolName {
  return implementedToolNames.has(tool as AiToolName)
}
