import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appStyles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const aiStyles = readFileSync(new URL('../src/views/ai/AIChat.css', import.meta.url), 'utf8')
const dropdownSource = readFileSync(
  new URL('../src/components/Dropdown.tsx', import.meta.url),
  'utf8',
)

const skinIds = [
  'aurora-glass',
  'cyber-console',
  'paper-studio',
  'neo-minimal',
  'pulse-desk',
  'orbit-os',
  'monolith-pro',
]

const skinColorTokens = [
  '--icon-button-color:',
  '--icon-button-hover-color:',
  '--dropdown-icon-color:',
  '--dropdown-icon-hover-color:',
  '--dropdown-selected-bg:',
  '--dropdown-selected-text:',
]

function declarationsFor(styles: string, selector: string): string {
  const start = styles.indexOf(`${selector} {`)
  assert.notEqual(start, -1, `missing CSS rule for ${selector}`)

  const declarationStart = styles.indexOf('{', start)
  const declarationEnd = styles.indexOf('\n}', declarationStart)
  assert.notEqual(declarationStart, -1, `missing opening brace for ${selector}`)
  assert.notEqual(declarationEnd, -1, `missing closing brace for ${selector}`)

  return styles.slice(declarationStart + 1, declarationEnd)
}

test('appearance skins define dedicated dropdown and icon button color tokens', () => {
  for (const skinId of skinIds) {
    const block = appStyles.match(new RegExp(`body\\.skin-${skinId}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1]

    assert.ok(block, `missing CSS block for skin ${skinId}`)
    for (const token of skinColorTokens) {
      assert.ok(block.includes(token), `${skinId} should define ${token}`)
    }
  }
})

test('dropdowns consume skin-specific color tokens instead of raw accent colors', () => {
  assert.match(
    declarationsFor(appStyles, '.dropdown__menu'),
    /background:\s*var\(--dropdown-menu-bg\)/,
  )
  assert.match(
    declarationsFor(appStyles, '.dropdown__control-icon'),
    /color:\s*var\(--dropdown-icon-color\)/,
  )
  assert.match(
    declarationsFor(appStyles, '.dropdown__indicator'),
    /color:\s*var\(--dropdown-icon-color\)/,
  )

  const selectedOption = declarationsFor(appStyles, '.dropdown__option--is-selected')
  assert.match(selectedOption, /background:\s*var\(--dropdown-selected-bg\)/)
  assert.match(selectedOption, /color:\s*var\(--dropdown-selected-text\)/)
  assert.doesNotMatch(selectedOption, /color:\s*var\(--color-accent\)/)
  assert.match(dropdownSource, /transition:\s*\n\s*'border-color var\(--motion-fast\) ease/)
  assert.doesNotMatch(dropdownSource, /transition:\s*'all 0\.1s ease'/)
})

test('topbar dropdown surfaces stay above the scrolling content pane', () => {
  assert.match(declarationsFor(appStyles, '.top-bar'), /z-index:\s*30/)
  assert.match(declarationsFor(appStyles, '.sidebar-display-menu__panel'), /z-index:\s*31/)
  assert.match(
    declarationsFor(appStyles, '.sidebar-display-menu__panel'),
    /background:\s*var\(--surface-menu\)/,
  )
})

test('icon-only buttons consume skin-specific color tokens', () => {
  const iconButton = declarationsFor(
    appStyles,
    ".btn:where(.btn-icon, .btn-icon-close, [class*='icon-button']):where(:not(.primary):not(.danger))",
  )
  assert.match(iconButton, /color:\s*var\(--icon-button-color\)/)

  assert.match(
    appStyles,
    /\.btn:where\(\.btn-icon, \.btn-icon-close, \[class\*='icon-button'\]\):where\([\s\S]*?:not\(\.primary\):not\(\.danger\)[\s\S]*?\):hover:not\(:disabled\)\s*\{[\s\S]*?color:\s*var\(--icon-button-hover-color\)/,
  )
  assert.match(
    declarationsFor(aiStyles, '.ai-chat-icon-button'),
    /color:\s*var\(--icon-button-color\)/,
  )
  assert.match(
    declarationsFor(aiStyles, '.ai-chat-icon-button:hover'),
    /color:\s*var\(--icon-button-hover-color\)/,
  )

  const topbarToolButton = declarationsFor(appStyles, '.topbar-tool-button')
  assert.match(topbarToolButton, /color:\s*var\(--icon-button-color\)/)
  assert.doesNotMatch(topbarToolButton, /color:\s*var\(--color-accent\)/)

  const topbarToolButtonHover = declarationsFor(appStyles, '.topbar-tool-button:hover')
  assert.match(topbarToolButtonHover, /background:\s*var\(--icon-button-hover-bg\)/)
  assert.match(topbarToolButtonHover, /color:\s*var\(--icon-button-hover-color\)/)
})

test('primary controls keep a stable hit area during hover', () => {
  assert.doesNotMatch(declarationsFor(appStyles, '.btn:hover:not(:disabled)'), /transform:/)
  assert.doesNotMatch(declarationsFor(appStyles, '.topbar-tool-button:hover'), /transform:/)
  assert.doesNotMatch(declarationsFor(appStyles, '.nav-item:hover'), /transform:/)
})

test('sidebar brand divider shares the topbar boundary', () => {
  assert.match(appStyles, /--sidebar-padding:\s*0\s+6px\s+12px/)
  assert.match(declarationsFor(appStyles, '.sidebar-brand'), /height:\s*var\(--topbar-height\)/)
  assert.match(declarationsFor(appStyles, '.sidebar-brand'), /border-bottom:\s*1px solid var\(--color-border\)/)
})

test('checkbox tokens resolve against the active skin instead of root defaults', () => {
  assert.match(
    appStyles,
    /body\s*\{[\s\S]*--checkbox-checked-bg:\s*var\(--color-accent\)[\s\S]*--checkbox-check-color:\s*var\(--text-on-accent\)/,
  )
})
