import type { AppearanceEngine, AppearanceSettings } from './appearance'

export interface AnimationEngineInfo {
  engine: AppearanceEngine
  displayName: string
  packageName: string
  role: string
}

export const ANIMATION_ENGINE_INFO: Record<AppearanceEngine, AnimationEngineInfo> = {
  css: {
    engine: 'css',
    displayName: 'CSS Motion',
    packageName: 'native-css',
    role: 'Baseline transitions and reduced-motion fallback',
  },
  gsap: {
    engine: 'gsap',
    displayName: 'GSAP',
    packageName: 'gsap',
    role: 'Timeline-driven shell, launch, and command palette transitions',
  },
  anime: {
    engine: 'anime',
    displayName: 'Anime.js',
    packageName: 'animejs',
    role: 'Text, list, SVG, and staggered dense-surface motion',
  },
  mojs: {
    engine: 'mojs',
    displayName: 'Mo.js',
    packageName: '@mojs/core',
    role: 'Burst, shape, and completion micro-interactions',
  },
  lottie: {
    engine: 'lottie',
    displayName: 'Lottie',
    packageName: '@lottiefiles/dotlottie-react',
    role: 'Long-running task loaders and empty states',
  },
  velocity: {
    engine: 'velocity',
    displayName: 'Velocity.js',
    packageName: 'velocity-animate',
    role: 'Fast compatibility-oriented DOM transitions',
  },
  popmotion: {
    engine: 'popmotion',
    displayName: 'Popmotion',
    packageName: 'popmotion',
    role: 'Spring and tween primitives for responsive state feedback',
  },
}

const engineLoaders: Record<AppearanceEngine, () => Promise<unknown>> = {
  css: async () => ANIMATION_ENGINE_INFO.css,
  gsap: () => import('gsap'),
  anime: () => import('animejs'),
  mojs: () => import('@mojs/core'),
  lottie: () => import('@lottiefiles/dotlottie-react'),
  velocity: () => import('velocity-animate'),
  popmotion: () => import('popmotion'),
}

const engineCache = new Map<AppearanceEngine, Promise<unknown>>()

export const getAnimationEngineInfo = (engine: AppearanceEngine): AnimationEngineInfo =>
  ANIMATION_ENGINE_INFO[engine]

export const getAppearanceAnimationEnginePlan = (
  appearance: Pick<AppearanceSettings, 'engine' | 'secondaryEngine'>,
): AnimationEngineInfo[] => {
  const engines = [appearance.engine, appearance.secondaryEngine].filter(
    (engine, index, values): engine is AppearanceEngine =>
      Boolean(engine) && values.indexOf(engine) === index,
  )
  return engines.map((engine) => ANIMATION_ENGINE_INFO[engine])
}

export const loadAnimationEngine = (engine: AppearanceEngine): Promise<unknown> => {
  if (!engineCache.has(engine)) {
    engineCache.set(
      engine,
      engineLoaders[engine]().catch((error: unknown) => ({
        unavailable: true,
        engine,
        error: error instanceof Error ? error.message : String(error),
      })),
    )
  }
  return engineCache.get(engine) as Promise<unknown>
}

export const preloadAppearanceAnimationEngines = async (
  appearance: Pick<AppearanceSettings, 'engine' | 'secondaryEngine' | 'motion'>,
) => {
  if (appearance.motion === 'reduced') return []
  const plan = getAppearanceAnimationEnginePlan(appearance).filter((info) => info.engine !== 'css')
  return Promise.all(plan.map((info) => loadAnimationEngine(info.engine)))
}

