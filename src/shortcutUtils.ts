type ShortcutKeyboardEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const keyAliases: Record<string, string> = {
  ' ': 'Space',
  '+': 'Plus',
  '=': 'Plus',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  enter: 'Return',
}

const supportedSpecialKeys = new Set([
  'Space',
  'Plus',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
])

export function normalizeShortcutKey(key: string) {
  const trimmed = key.trim()
  const normalized = keyAliases[key] || keyAliases[trimmed.toLowerCase()] || trimmed
  if (/^[a-z0-9]$/i.test(normalized)) return normalized.toUpperCase()
  return normalized
}

function isSupportedShortcutKey(key: string) {
  return /^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key) || supportedSpecialKeys.has(key)
}

export function shortcutFromKeyboardEvent(event: ShortcutKeyboardEvent) {
  const key = normalizeShortcutKey(event.key)
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key) || !isSupportedShortcutKey(key)) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (parts.length === 0 && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return null
  parts.push(key)
  return parts.join('+')
}

export function matchesShortcut(event: ShortcutKeyboardEvent, shortcut: string) {
  const parts = shortcut.toLowerCase().split('+')
  const configuredKey = normalizeShortcutKey(parts.at(-1) || '').toLowerCase()
  const eventKey = normalizeShortcutKey(event.key).toLowerCase()
  const primary = parts.includes('commandorcontrol')
  const hasAlt = parts.includes('alt')
  const hasShift = parts.includes('shift')
  return (
    Boolean(configuredKey) &&
    primary === (event.ctrlKey || event.metaKey) &&
    hasAlt === event.altKey &&
    hasShift === event.shiftKey &&
    eventKey === configuredKey
  )
}

export function displayShortcut(shortcut: string, isMac: boolean) {
  return shortcut
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replaceAll('+', ' + ')
}
