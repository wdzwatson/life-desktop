import assert from 'node:assert/strict'
import test from 'node:test'
import { appearanceFromPreset } from '../src/appearance.ts'
import {
  getAnimationEngineInfo,
  getAppearanceAnimationEnginePlan,
  preloadAppearanceAnimationEngines,
} from '../src/animationEngines.ts'

test('animation engine metadata exposes requested libraries', () => {
  assert.equal(getAnimationEngineInfo('anime').packageName, 'animejs')
  assert.equal(getAnimationEngineInfo('mojs').packageName, '@mojs/core')
  assert.equal(getAnimationEngineInfo('lottie').packageName, '@lottiefiles/dotlottie-react')
  assert.equal(getAnimationEngineInfo('velocity').packageName, 'velocity-animate')
  assert.equal(getAnimationEngineInfo('popmotion').packageName, 'popmotion')
  assert.equal(getAnimationEngineInfo('gsap').packageName, 'gsap')
})

test('appearance engine plans deduplicate primary and secondary engines', () => {
  const plan = getAppearanceAnimationEnginePlan({ engine: 'gsap', secondaryEngine: 'gsap' })
  assert.deepEqual(
    plan.map((engine) => engine.engine),
    ['gsap'],
  )
})

test('appearance presets declare engine plans', () => {
  assert.deepEqual(
    getAppearanceAnimationEnginePlan(appearanceFromPreset('aurora-flow')).map((engine) => engine.engine),
    ['gsap', 'lottie'],
  )
  assert.deepEqual(
    getAppearanceAnimationEnginePlan(appearanceFromPreset('orbit-os')).map((engine) => engine.engine),
    ['mojs', 'gsap'],
  )
})

test('reduced motion skips optional engine preloading', async () => {
  const result = await preloadAppearanceAnimationEngines({
    engine: 'anime',
    secondaryEngine: 'gsap',
    motion: 'reduced',
  })
  assert.deepEqual(result, [])
})

