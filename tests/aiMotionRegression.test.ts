import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const component = readFileSync(path.resolve('src/views/ai/AIOnboarding.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')

test('onboarding registers pinning and card stacking only after reduced-motion exits', () => {
  const reducedMotionGuard = component.indexOf("matchMedia('(prefers-reduced-motion: reduce)').matches) return")
  const cardStacking = component.indexOf("querySelectorAll<HTMLElement>('.ai-onboarding-stack__card')")
  const scrollPinning = component.indexOf('ScrollTrigger.create({')
  assert.ok(reducedMotionGuard > -1)
  assert.ok(cardStacking > reducedMotionGuard)
  assert.ok(scrollPinning > reducedMotionGuard)
  assert.match(component, /scrub:\s*0\.8/)
  assert.match(component, /pin:\s*aside/)
})

test('marquee, accordion, and card motion have a reduced-motion fallback', () => {
  assert.match(component, /ai-onboarding-marquee/)
  assert.match(component, /ai-onboarding-accordion/)
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.ai-onboarding-marquee > div[\s\S]*animation:\s*none/)
  assert.match(css, /\.ai-onboarding-accordion button:hover[\s\S]*flex:\s*2\.3/)
  assert.match(css, /button\.ai-onboarding-bento__card:hover[\s\S]*transform:\s*scale\(1\.05\)/)
})
