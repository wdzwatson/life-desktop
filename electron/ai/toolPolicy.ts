import type { AIToolApprovalMode, AIToolRisk } from './types'

export type AIMcpToolDescriptor = {
  name: string
  description?: string
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
}

const COMMAND_PATTERN = /(?:^|[_\-.])(exec|execute|command|shell|terminal|process|spawn|run)(?:$|[_\-.])/i
const WRITE_PATTERN = /(?:^|[_\-.])(create|update|write|delete|remove|rename|move|send|publish|post|upload|install)(?:$|[_\-.])/i

export function classifyAIToolRisk(tool: AIMcpToolDescriptor): AIToolRisk {
  const searchable = `${tool.name} ${tool.description ?? ''}`
  if (COMMAND_PATTERN.test(searchable)) return 'command'
  if (tool.annotations?.openWorldHint && !tool.annotations.readOnlyHint) return 'external_side_effect'
  if (tool.annotations?.destructiveHint || tool.annotations?.readOnlyHint === false || WRITE_PATTERN.test(searchable)) {
    return 'write'
  }
  return 'read'
}

export function shouldApproveAITool(input: {
  mode: AIToolApprovalMode
  risk: AIToolRisk
  qualifiedToolName: string
  allowedTools?: string[]
}) {
  if (input.mode === 'confirm_all') return true
  if (input.mode === 'allow_all') return false
  if (input.mode === 'confirm_risky') return input.risk !== 'read'
  return !(input.allowedTools ?? []).includes(input.qualifiedToolName)
}

export function resolveAIToolRisk(
  tool: AIMcpToolDescriptor,
  override?: AIToolRisk,
): AIToolRisk {
  return override ?? classifyAIToolRisk(tool)
}
