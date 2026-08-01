export type LaunchpadStartupMode = 'always' | 'daily' | 'resume'

export interface LaunchpadContext {
  screen: string
  label?: string
  updatedAt: number
}

export interface LaunchpadSettings {
  startupMode: LaunchpadStartupMode
  lastShownDate?: string
  lastContext?: LaunchpadContext
  posterVersion?: string
}

export interface LaunchpadTaskSummary {
  overdue: number
  today: number
}

export interface LaunchpadRecommendation {
  kind: 'overdue' | 'today' | 'continue' | 'empty' | 'default'
  targetScreen: string
}

export const defaultLaunchpadSettings: LaunchpadSettings = { startupMode: 'daily' }

export function isLaunchpadStartupMode(value: unknown): value is LaunchpadStartupMode {
  return value === 'always' || value === 'daily' || value === 'resume'
}

export function normalizeLaunchpadSettings(value: unknown): LaunchpadSettings {
  if (!value || typeof value !== 'object') return { ...defaultLaunchpadSettings }
  const settings = value as Partial<LaunchpadSettings>
  return {
    startupMode: isLaunchpadStartupMode(settings.startupMode) ? settings.startupMode : 'daily',
    ...(typeof settings.lastShownDate === 'string' ? { lastShownDate: settings.lastShownDate } : {}),
    ...(typeof settings.posterVersion === 'string' ? { posterVersion: settings.posterVersion } : {}),
    ...(settings.lastContext && typeof settings.lastContext.screen === 'string'
      ? {
          lastContext: {
            screen: settings.lastContext.screen,
            ...(typeof settings.lastContext.label === 'string'
              ? { label: settings.lastContext.label }
              : {}),
            updatedAt:
              typeof settings.lastContext.updatedAt === 'number'
                ? settings.lastContext.updatedAt
                : 0,
          },
        }
      : {}),
  }
}

export function toLaunchpadDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shouldShowLaunchpad(
  settings: LaunchpadSettings,
  dateKey = toLaunchpadDateKey(),
) {
  if (settings.startupMode === 'always') return true
  if (settings.startupMode === 'resume') return false
  return settings.lastShownDate !== dateKey
}

export function getLaunchpadRecommendation(input: {
  tasks: LaunchpadTaskSummary
  hasWorkspaceContent: boolean
  context?: LaunchpadContext
}): LaunchpadRecommendation {
  if (input.tasks.overdue > 0) return { kind: 'overdue', targetScreen: 'tasks' }
  if (input.tasks.today > 0) return { kind: 'today', targetScreen: 'tasks' }
  if (input.context) return { kind: 'continue', targetScreen: input.context.screen }
  if (!input.hasWorkspaceContent) return { kind: 'empty', targetScreen: 'tasks' }
  return { kind: 'default', targetScreen: 'tasks' }
}
