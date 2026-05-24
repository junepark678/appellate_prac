import type { AiToolName } from '../domain/types'

export const implementedToolNames = new Set<AiToolName>([
  'issueClerkOrder',
  'fileCounterpartyDocument',
  'setDeadline',
  'submitToPanel',
  'issuePanelOrder',
  'disposeCase',
  'recommendClerkAction',
  'draftClerkOrder',
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
