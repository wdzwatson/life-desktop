import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APPEARANCE_PRESET_IDS,
  appearanceFromPreset,
  applyAppearanceToDocument,
  getAppearanceBodyClasses,
  getNextAppearancePresetId,
  legacyThemeFromAppearance,
  normalizeAppearanceSettings,
  presetIdFromLegacyTheme,
} from '../src/appearance.ts'

test('appearance settings normalize to the stable default', () => {
  assert.deepEqual(normalizeAppearanceSettings(), appearanceFromPreset('neo-minimal'))
  assert.deepEqual(
    normalizeAppearanceSettings({ preset: 'missing', skin: 'also-missing' }),
    appearanceFromPreset('neo-minimal'),
  )
})

test('legacy themes migrate to compatible appearance presets', () => {
  assert.equal(presetIdFromLegacyTheme('Minimal'), 'neo-minimal')
  assert.equal(presetIdFromLegacyTheme('Dense'), 'monolith-pro')
  assert.equal(presetIdFromLegacyTheme('Card'), 'paper-studio')
  assert.equal(presetIdFromLegacyTheme('Dark Tech'), 'cyber-console')
  assert.equal(normalizeAppearanceSettings(undefined, 'Dark Tech').preset, 'cyber-console')
})

test('preset defaults can be partially overridden by advanced settings', () => {
  const appearance = normalizeAppearanceSettings({
    preset: 'aurora-flow',
    skin: 'paper-studio',
    layout: 'compact-dense',
    motion: 'reduced',
    loading: 'terminal-scan',
    engine: 'anime',
  })
  assert.equal(appearance.preset, 'aurora-flow')
  assert.equal(appearance.skin, 'paper-studio')
  assert.equal(appearance.layout, 'compact-dense')
  assert.equal(appearance.motion, 'reduced')
  assert.equal(appearance.loading, 'terminal-scan')
  assert.equal(appearance.engine, 'anime')
})

test('appearance classes include preset axes and legacy compatibility class', () => {
  const classes = getAppearanceBodyClasses(appearanceFromPreset('cyber-console'))
  assert.ok(classes.includes('preset-cyber-console'))
  assert.ok(classes.includes('skin-cyber-console'))
  assert.ok(classes.includes('layout-inspector-layout'))
  assert.ok(classes.includes('motion-snappy'))
  assert.ok(classes.includes('loading-terminal-scan'))
  assert.ok(classes.includes('engine-anime'))
  assert.ok(classes.includes('theme-dark-tech'))
})

test('appearance preset cycling follows the configured sequence', () => {
  assert.equal(getNextAppearancePresetId('aurora-flow'), 'cyber-console')
  assert.equal(getNextAppearancePresetId(APPEARANCE_PRESET_IDS.at(-1)), 'aurora-flow')
})

test('legacy theme compatibility follows the preset family', () => {
  assert.equal(legacyThemeFromAppearance(appearanceFromPreset('paper-studio')), 'Card')
  assert.equal(legacyThemeFromAppearance(appearanceFromPreset('monolith-pro')), 'Dense')
})

test('document appearance application is safe when no body is available', () => {
  assert.doesNotThrow(() => applyAppearanceToDocument(appearanceFromPreset('orbit-os'), undefined))
})

test('document appearance application removes stale legacy theme classes', () => {
  const body = {
    classList: {
      values: new Set(['theme-minimal', 'theme-dark-tech', 'minimal', 'skin-neo-minimal', 'custom-class']),
      add(...classes: string[]) {
        for (const className of classes) this.values.add(className)
      },
      remove(className: string) {
        this.values.delete(className)
      },
      [Symbol.iterator]() {
        return this.values[Symbol.iterator]()
      },
    },
    dataset: {} as Record<string, string>,
  } as unknown as HTMLElement

  applyAppearanceToDocument(appearanceFromPreset('monolith-pro'), body)
  const classes = Array.from(body.classList)
  assert.ok(classes.includes('custom-class'))
  assert.ok(classes.includes('theme-dense'))
  assert.ok(classes.includes('skin-monolith-pro'))
  assert.ok(!classes.includes('theme-minimal'))
  assert.ok(!classes.includes('theme-dark-tech'))
  assert.ok(!classes.includes('minimal'))
  assert.ok(!classes.includes('skin-neo-minimal'))
})
