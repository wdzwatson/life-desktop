import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

const workspace = process.cwd()

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

test('the application confirmation service uses the accessible dialog contract', () => {
  const provider = readFileSync(resolve(workspace, 'src/components/ConfirmationProvider.tsx'), 'utf8')
  const main = readFileSync(resolve(workspace, 'src/main.tsx'), 'utf8')

  assert.match(provider, /createContext<ConfirmationContextValue \| null>/)
  assert.match(provider, /confirm: \(options: ConfirmationOptions\) => Promise<boolean>/)
  assert.match(provider, /<AccessibleDialog[\s\S]*role="alertdialog"[\s\S]*returnFocus=\{\(\) => pending\.returnFocus\?\.focus\(\)\}[\s\S]*initialFocusRef=\{cancelButtonRef\}/)
  assert.match(provider, /className=\{`btn \$\{pending\.tone === 'danger' \? 'danger' : 'primary'\}`\}/)
  assert.match(provider, /pendingRef\.current\.resolve\(false\)/)
  assert.match(main, /<ConfirmationProvider>[\s\S]*<App \/>[\s\S]*<\/ConfirmationProvider>/)
})

test('application source does not use browser-native confirmation dialogs', () => {
  const nativeConfirmPattern = /window\.confirm\s*\(/
  const matches = sourceFiles(resolve(workspace, 'src'))
    .filter((file) => nativeConfirmPattern.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(workspace.length + 1))

  assert.deepEqual(matches, [])
})
