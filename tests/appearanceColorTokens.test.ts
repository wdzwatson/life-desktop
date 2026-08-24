import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appStyles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const aiStyles = readFileSync(new URL('../src/views/ai/AIChat.css', import.meta.url), 'utf8')

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
})
