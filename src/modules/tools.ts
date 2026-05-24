import type { AiToolName } from '../domain/types'

export const implementedToolNames = new Set<AiToolName>([
  'issueClerkOrder',
  'fileCounterpartyDocument',
  'setDeadline',
  'submitToPanel',
  'issuePanelOrder',
  'disposeCase',
])

export function isImplementedAiTool(tool: string): tool is AiToolName {
  return implementedToolNames.has(tool as AiToolName)
}
