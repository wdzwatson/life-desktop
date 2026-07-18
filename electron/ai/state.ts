import type { AIMediaTaskStatus, AIRunStatus } from './types'

const RUN_TRANSITIONS: Record<AIRunStatus, readonly AIRunStatus[]> = {
  queued: ['running', 'failed', 'cancelled', 'interrupted'],
  running: [
    'waiting_for_tool',
    'waiting_for_approval',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ],
  waiting_for_tool: ['running', 'waiting_for_approval', 'failed', 'cancelled', 'interrupted'],
  waiting_for_approval: ['waiting_for_tool', 'running', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
}

const MEDIA_TRANSITIONS: Record<AIMediaTaskStatus, readonly AIMediaTaskStatus[]> = {
  queued: ['generating', 'failed', 'cancelled', 'interrupted'],
  generating: ['polling', 'downloading', 'failed', 'cancelled', 'interrupted'],
  polling: ['polling', 'downloading', 'failed', 'cancelled', 'interrupted'],
  downloading: ['processing', 'completed', 'failed', 'cancelled', 'interrupted'],
  processing: ['completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: ['polling', 'failed', 'cancelled'],
}

const RUN_TERMINAL = new Set<AIRunStatus>(['completed', 'failed', 'cancelled', 'interrupted'])
const MEDIA_TERMINAL = new Set<AIMediaTaskStatus>(['completed', 'failed', 'cancelled'])

export function isAIRunTerminal(status: AIRunStatus) {
  return RUN_TERMINAL.has(status)
}

export function isAIMediaTaskTerminal(status: AIMediaTaskStatus) {
  return MEDIA_TERMINAL.has(status)
}

export function canTransitionAIRun(from: AIRunStatus, to: AIRunStatus) {
  return RUN_TRANSITIONS[from].includes(to)
}

export function canTransitionAIMediaTask(from: AIMediaTaskStatus, to: AIMediaTaskStatus) {
  return MEDIA_TRANSITIONS[from].includes(to)
}

export function assertAIRunTransition(from: AIRunStatus, to: AIRunStatus) {
  if (!canTransitionAIRun(from, to)) {
    throw new Error(`Invalid AI run transition: ${from} -> ${to}`)
  }
}

export function assertAIMediaTaskTransition(from: AIMediaTaskStatus, to: AIMediaTaskStatus) {
  if (!canTransitionAIMediaTask(from, to)) {
    throw new Error(`Invalid AI media transition: ${from} -> ${to}`)
  }
}

export function getInterruptedAIRunStatus(status: AIRunStatus): AIRunStatus {
  return isAIRunTerminal(status) ? status : 'interrupted'
}

export function getInterruptedAIMediaTaskStatus(status: AIMediaTaskStatus): AIMediaTaskStatus {
  if (isAIMediaTaskTerminal(status)) return status
  return 'interrupted'
}
