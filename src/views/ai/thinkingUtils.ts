export type AIThinkingLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const CLAUDE_STANDARD: AIThinkingLevel[] = ['low', 'medium', 'high']
const CLAUDE_OPUS: AIThinkingLevel[] = ['low', 'medium', 'high', 'max']
const GPT_STANDARD: AIThinkingLevel[] = ['low', 'medium', 'high']
const GPT_56: AIThinkingLevel[] = ['none', 'low', 'medium', 'high']
const GPT_56_SOL: AIThinkingLevel[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
const GEMINI: AIThinkingLevel[] = ['minimal', 'low', 'medium', 'high']
const GROK: AIThinkingLevel[] = ['low', 'high']
const DEFAULT: AIThinkingLevel[] = ['medium']

export function getAIThinkingLevels(modelId: string | undefined): AIThinkingLevel[] {
  const model = modelId?.trim().toLocaleLowerCase() ?? ''
  if (model.startsWith('claude-opus-')) return CLAUDE_OPUS
  if (model.startsWith('claude-')) return CLAUDE_STANDARD
  if (model === 'gpt-5.6-sol') return GPT_56_SOL
  if (model === 'gpt-5.6' || model.startsWith('gpt-5.6-')) return GPT_56
  if (model.startsWith('gpt-5.')) return GPT_STANDARD
  if (model.startsWith('gemini-')) return GEMINI
  if (model.startsWith('grok-')) return GROK
  return DEFAULT
}
