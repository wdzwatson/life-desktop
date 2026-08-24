export const APPEARANCE_PRESET_IDS = [
  'aurora-flow',
  'cyber-console',
  'paper-studio',
  'neo-minimal',
  'pulse-desk',
  'orbit-os',
  'monolith-pro',
] as const

export const APPEARANCE_SKINS = [
  'aurora-glass',
  'cyber-console',
  'paper-studio',
  'neo-minimal',
  'pulse-desk',
  'orbit-os',
  'monolith-pro',
] as const

export const APPEARANCE_LAYOUTS = [
  'classic-shell',
  'command-center',
  'focus-canvas',
  'inspector-layout',
  'compact-dense',
  'spatial-dashboard',
  'dense-workspace',
] as const

export const APPEARANCE_MOTION = ['calm', 'snappy', 'expressive', 'reduced'] as const

export const APPEARANCE_LOADING = [
  'precision-skeleton',
  'lottie-flow',
  'terminal-scan',
  'paper-skeleton',
  'pulse-bars',
  'particle-burst',
  'matrix-rails',
] as const

export const APPEARANCE_ENGINES = [
  'css',
  'gsap',
  'anime',
  'mojs',
  'lottie',
  'velocity',
  'popmotion',
] as const

export type AppearancePresetId = (typeof APPEARANCE_PRESET_IDS)[number]
export type AppearanceSkin = (typeof APPEARANCE_SKINS)[number]
export type AppearanceLayout = (typeof APPEARANCE_LAYOUTS)[number]
export type AppearanceMotion = (typeof APPEARANCE_MOTION)[number]
export type AppearanceLoading = (typeof APPEARANCE_LOADING)[number]
export type AppearanceEngine = (typeof APPEARANCE_ENGINES)[number]

export interface AppearanceSettings {
  preset: AppearancePresetId
  skin: AppearanceSkin
  layout: AppearanceLayout
  motion: AppearanceMotion
  loading: AppearanceLoading
  engine: AppearanceEngine
  secondaryEngine?: AppearanceEngine
}

export interface AppearancePreset extends AppearanceSettings {
  name: string
  labelKey: string
  descriptionKey: string
  engineLabel: string
  swatches: readonly [string, string, string]
}

export const DEFAULT_APPEARANCE_PRESET_ID: AppearancePresetId = 'neo-minimal'

export const APPEARANCE_PRESETS: Record<AppearancePresetId, AppearancePreset> = {
  'aurora-flow': {
    preset: 'aurora-flow',
    skin: 'aurora-glass',
    layout: 'command-center',
    motion: 'expressive',
    loading: 'lottie-flow',
    engine: 'gsap',
    secondaryEngine: 'lottie',
    name: 'Aurora Flow',
    labelKey: 'settings.appearance_preset_aurora_flow',
    descriptionKey: 'settings.appearance_preset_aurora_flow_desc',
    engineLabel: 'GSAP + Lottie',
    swatches: ['#101827', '#7c3aed', '#22d3ee'],
  },
  'cyber-console': {
    preset: 'cyber-console',
    skin: 'cyber-console',
    layout: 'inspector-layout',
    motion: 'snappy',
    loading: 'terminal-scan',
    engine: 'anime',
    secondaryEngine: 'gsap',
    name: 'Cyber Console',
    labelKey: 'settings.appearance_preset_cyber_console',
    descriptionKey: 'settings.appearance_preset_cyber_console_desc',
    engineLabel: 'Anime.js + GSAP',
    swatches: ['#030712', '#00f5d4', '#38bdf8'],
  },
  'paper-studio': {
    preset: 'paper-studio',
    skin: 'paper-studio',
    layout: 'focus-canvas',
    motion: 'calm',
    loading: 'paper-skeleton',
    engine: 'lottie',
    secondaryEngine: 'css',
    name: 'Paper Studio',
    labelKey: 'settings.appearance_preset_paper_studio',
    descriptionKey: 'settings.appearance_preset_paper_studio_desc',
    engineLabel: 'Lottie + CSS',
    swatches: ['#f8f1e5', '#7c5c42', '#d97706'],
  },
  'neo-minimal': {
    preset: 'neo-minimal',
    skin: 'neo-minimal',
    layout: 'classic-shell',
    motion: 'calm',
    loading: 'precision-skeleton',
    engine: 'velocity',
    secondaryEngine: 'css',
    name: 'Neo Minimal',
    labelKey: 'settings.appearance_preset_neo_minimal',
    descriptionKey: 'settings.appearance_preset_neo_minimal_desc',
    engineLabel: 'Velocity.js + CSS',
    swatches: ['#f8fafc', '#2563eb', '#0f172a'],
  },
  'pulse-desk': {
    preset: 'pulse-desk',
    skin: 'pulse-desk',
    layout: 'compact-dense',
    motion: 'snappy',
    loading: 'pulse-bars',
    engine: 'popmotion',
    name: 'Pulse Desk',
    labelKey: 'settings.appearance_preset_pulse_desk',
    descriptionKey: 'settings.appearance_preset_pulse_desk_desc',
    engineLabel: 'Popmotion',
    swatches: ['#f7fbff', '#ef476f', '#06d6a0'],
  },
  'orbit-os': {
    preset: 'orbit-os',
    skin: 'orbit-os',
    layout: 'spatial-dashboard',
    motion: 'expressive',
    loading: 'particle-burst',
    engine: 'mojs',
    secondaryEngine: 'gsap',
    name: 'Orbit OS',
    labelKey: 'settings.appearance_preset_orbit_os',
    descriptionKey: 'settings.appearance_preset_orbit_os_desc',
    engineLabel: 'Mo.js + GSAP',
    swatches: ['#080f2a', '#f59e0b', '#8b5cf6'],
  },
  'monolith-pro': {
    preset: 'monolith-pro',
    skin: 'monolith-pro',
    layout: 'dense-workspace',
    motion: 'snappy',
    loading: 'matrix-rails',
    engine: 'anime',
    secondaryEngine: 'velocity',
    name: 'Monolith Pro',
    labelKey: 'settings.appearance_preset_monolith_pro',
    descriptionKey: 'settings.appearance_preset_monolith_pro_desc',
    engineLabel: 'Anime.js + Velocity.js',
    swatches: ['#050505', '#f5f5f5', '#9ca3af'],
  },
}

export const DEFAULT_APPEARANCE = APPEARANCE_PRESETS[DEFAULT_APPEARANCE_PRESET_ID]

export const LEGACY_THEME_PRESET_MAP: Record<string, AppearancePresetId> = {
  minimal: 'neo-minimal',
  dense: 'monolith-pro',
  card: 'paper-studio',
  'dark tech': 'cyber-console',
  'dark-tech': 'cyber-console',
}

export const PRESET_LEGACY_THEME_MAP: Record<AppearancePresetId, string> = {
  'aurora-flow': 'Dark Tech',
  'cyber-console': 'Dark Tech',
  'paper-studio': 'Card',
  'neo-minimal': 'Minimal',
  'pulse-desk': 'Minimal',
  'orbit-os': 'Dark Tech',
  'monolith-pro': 'Dense',
}

const hasStringProperty = (value: unknown, property: string): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[property] === 'string'

const includesString = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)

export const isAppearancePresetId = (value: unknown): value is AppearancePresetId =>
  includesString(APPEARANCE_PRESET_IDS, value)

export const isAppearanceSkin = (value: unknown): value is AppearanceSkin =>
  includesString(APPEARANCE_SKINS, value)

export const isAppearanceLayout = (value: unknown): value is AppearanceLayout =>
  includesString(APPEARANCE_LAYOUTS, value)

export const isAppearanceMotion = (value: unknown): value is AppearanceMotion =>
  includesString(APPEARANCE_MOTION, value)

export const isAppearanceLoading = (value: unknown): value is AppearanceLoading =>
  includesString(APPEARANCE_LOADING, value)

export const isAppearanceEngine = (value: unknown): value is AppearanceEngine =>
  includesString(APPEARANCE_ENGINES, value)

export const presetIdFromLegacyTheme = (theme: unknown): AppearancePresetId | undefined => {
  if (typeof theme !== 'string') return undefined
  return LEGACY_THEME_PRESET_MAP[theme.trim().toLowerCase()]
}

export const legacyThemeFromAppearance = (appearance: Pick<AppearanceSettings, 'preset'>): string =>
  PRESET_LEGACY_THEME_MAP[appearance.preset] || PRESET_LEGACY_THEME_MAP[DEFAULT_APPEARANCE_PRESET_ID]

export const normalizeAppearanceSettings = (
  value?: unknown,
  legacyTheme?: unknown,
): AppearanceSettings => {
  const presetId = hasStringProperty(value, 'preset')
    ? isAppearancePresetId(value.preset)
      ? value.preset
      : presetIdFromLegacyTheme(legacyTheme) || DEFAULT_APPEARANCE_PRESET_ID
    : presetIdFromLegacyTheme(legacyTheme) || DEFAULT_APPEARANCE_PRESET_ID
  const base = APPEARANCE_PRESETS[presetId]
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

  return {
    preset: presetId,
    skin: isAppearanceSkin(source.skin) ? source.skin : base.skin,
    layout: isAppearanceLayout(source.layout) ? source.layout : base.layout,
    motion: isAppearanceMotion(source.motion) ? source.motion : base.motion,
    loading: isAppearanceLoading(source.loading) ? source.loading : base.loading,
    engine: isAppearanceEngine(source.engine) ? source.engine : base.engine,
    secondaryEngine: isAppearanceEngine(source.secondaryEngine)
      ? source.secondaryEngine
      : base.secondaryEngine,
  }
}

export const appearanceFromPreset = (presetId: AppearancePresetId): AppearanceSettings => {
  const { preset, skin, layout, motion, loading, engine, secondaryEngine } = APPEARANCE_PRESETS[presetId]
  return { preset, skin, layout, motion, loading, engine, secondaryEngine }
}

export const mergeAppearanceSettings = (
  current: AppearanceSettings,
  update: Partial<AppearanceSettings>,
): AppearanceSettings => normalizeAppearanceSettings({ ...current, ...update }, current.preset)

export const getNextAppearancePresetId = (current: unknown): AppearancePresetId => {
  const normalized = normalizeAppearanceSettings({ preset: current })
  const index = APPEARANCE_PRESET_IDS.indexOf(normalized.preset)
  return APPEARANCE_PRESET_IDS[(index + 1) % APPEARANCE_PRESET_IDS.length]
}

export const APPEARANCE_CLASS_PREFIXES = [
  'preset-',
  'skin-',
  'layout-',
  'motion-',
  'loading-',
  'engine-',
  'theme-',
] as const

export const getAppearanceBodyClasses = (appearance: AppearanceSettings): string[] => [
  `preset-${appearance.preset}`,
  `skin-${appearance.skin}`,
  `layout-${appearance.layout}`,
  `motion-${appearance.motion}`,
  `loading-${appearance.loading}`,
  `engine-${appearance.engine}`,
  `theme-${legacyThemeFromAppearance(appearance).toLowerCase().replaceAll(' ', '-')}`,
]

export const applyAppearanceToDocument = (
  appearance: AppearanceSettings,
  body: HTMLElement | undefined = globalThis.document?.body,
) => {
  if (!body) return
  const nextClasses = getAppearanceBodyClasses(appearance)
  for (const className of Array.from(body.classList)) {
    if (APPEARANCE_CLASS_PREFIXES.some((prefix) => className.startsWith(prefix))) {
      body.classList.remove(className)
    }
  }
  body.classList.add(...nextClasses)
  body.dataset.appearancePreset = appearance.preset
  body.dataset.appearanceSkin = appearance.skin
  body.dataset.appearanceLayout = appearance.layout
  body.dataset.appearanceMotion = appearance.motion
  body.dataset.appearanceLoading = appearance.loading
  body.dataset.appearanceEngine = appearance.engine
}

