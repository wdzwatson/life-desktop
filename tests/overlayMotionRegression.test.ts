import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const notesSource = readFileSync(new URL('../src/views/Notes.tsx', import.meta.url), 'utf8')
const videosSource = readFileSync(new URL('../src/views/Videos.tsx', import.meta.url), 'utf8')
const tasksSource = readFileSync(new URL('../src/views/Tasks.tsx', import.meta.url), 'utf8')
const tasksStyles = readFileSync(new URL('../src/views/Tasks.css', import.meta.url), 'utf8')
const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')
const booksStyles = readFileSync(new URL('../src/views/Books.css', import.meta.url), 'utf8')
const drawerMotionSource = readFileSync(
  new URL('../src/components/useDrawerTransition.ts', import.meta.url),
  'utf8',
)
const aiDrawerSources = [
  'ProviderManager.tsx',
  'ModelManager.tsx',
  'AgentManager.tsx',
  'McpManager.tsx',
].map((file) => readFileSync(new URL(`../src/views/ai/${file}`, import.meta.url), 'utf8'))
const chatWorkspaceSource = readFileSync(
  new URL('../src/views/ai/ChatWorkspace.tsx', import.meta.url),
  'utf8',
)
const aiStyles = readFileSync(new URL('../src/views/ai/AIChat.css', import.meta.url), 'utf8')
const dialogSource = readFileSync(
  new URL('../src/components/AccessibleDialog.tsx', import.meta.url),
  'utf8',
)
const statusbarSource = readFileSync(
  new URL('../src/components/Statusbar.tsx', import.meta.url),
  'utf8',
)
const globalStyles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const toolboxSource = readFileSync(new URL('../src/views/Toolbox.tsx', import.meta.url), 'utf8')
const appStoreSource = readFileSync(new URL('../src/store/useAppStore.ts', import.meta.url), 'utf8')

test('notes export dropdown closes from document events without a fixed backdrop', () => {
  const exportStart = notesSource.indexOf('{/* Export Button & Dropdown */}')
  const exportEnd = notesSource.indexOf(
    'onClick={() => handleDeleteNote(activeNoteId)}',
    exportStart,
  )
  const exportSource = notesSource.slice(exportStart, exportEnd)

  assert.notEqual(exportStart, -1)
  assert.notEqual(exportEnd, -1)
  assert.match(
    notesSource,
    /document\.addEventListener\('pointerdown', closeOnOutsidePointer, true\)/,
  )
  assert.match(exportSource, /ref=\{exportDropdownRef\}/)
  assert.doesNotMatch(exportSource, /position:\s*'fixed'/)
})

test('overlay drawers share the video GSAP enter and exit timeline', () => {
  const drawerStart = videosSource.indexOf('{isDrawerMounted && (')
  const drawerEnd = videosSource.indexOf('{parsedData && (', drawerStart)
  const drawerSource = videosSource.slice(drawerStart, drawerEnd)

  assert.notEqual(drawerStart, -1)
  assert.notEqual(drawerEnd, -1)
  assert.match(videosSource, /useDrawerTransition\(\)/)
  assert.match(tasksSource, /useDrawerTransition\(\(\) => setDrawerMode\(null\)\)/)
  assert.match(drawerMotionSource, /edgeOffset:\s*36/)
  assert.match(drawerMotionSource, /overlayEnterDuration:\s*0\.42/)
  assert.match(drawerMotionSource, /panelEnterDuration:\s*0\.66/)
  assert.match(drawerMotionSource, /panelExitDuration:\s*0\.44/)
  assert.match(drawerMotionSource, /overlayExitDuration:\s*0\.34/)
  assert.match(drawerMotionSource, /overlayExitDelay:\s*0\.04/)
  assert.match(drawerMotionSource, /panelEnterEase:\s*'expo\.out'/)
  assert.match(drawerMotionSource, /panelExitEase:\s*'power3\.inOut'/)
  assert.match(drawerMotionSource, /xPercent:\s*direction === 'right' \? 100 : -100/)
  assert.match(drawerMotionSource, /scale:\s*0\.985/)
  assert.match(drawerMotionSource, /filter:\s*'blur\(8px\)'/)
  assert.match(
    drawerMotionSource,
    /setIsDrawerMounted\(false\)[\s\S]*onExitCompleteRef\.current\(\)/,
  )
  assert.match(drawerSource, /ref=\{drawerOverlayRef\}/)
  assert.match(drawerSource, /ref=\{drawerPanelRef\}/)
  assert.match(tasksSource, /drawerMode && isTaskDrawerMounted/)
  assert.match(tasksSource, /isTaskDrawerOpen \? 'is-open' : 'is-closing'/)
  assert.match(tasksSource, /onMouseDown=\{closeTaskDrawer\}/)
  assert.match(tasksSource, /ref=\{taskDrawerOverlayRef\}/)
  assert.match(tasksSource, /ref=\{taskDrawerPanelRef\}/)
  assert.match(tasksSource, /drawer-motion-overlay task-drawer-backdrop/)
  assert.match(videosSource, /className="drawer-motion-overlay"/)
  assert.match(
    globalStyles,
    /\.drawer-motion-overlay\s*\{[\s\S]*var\(--overlay-drawer-bg\)[\s\S]*var\(--overlay-drawer-blur\)/,
  )
  assert.doesNotMatch(tasksStyles, /transition:\s*opacity var\(--drawer/)
  aiDrawerSources.forEach((source) => {
    assert.match(source, /useDrawerTransition\(/)
    assert.match(source, /motionOverlayRef=\{drawerOverlayRef\}/)
    assert.match(source, /motionPanelRef=\{drawerPanelRef\}/)
    assert.match(source, /drawer-motion-overlay ai-settings-drawer-overlay/)
  })
  assert.match(
    aiStyles,
    /\.dialog-overlay\.ai-settings-drawer-overlay\.is-closing,[\s\S]*animation:\s*none/,
  )
})

test('docked drawers reuse the shared directional panel transition', () => {
  assert.match(booksSource, /useDrawerPanelTransition\(isTocDrawerOpen, 'left'\)/)
  assert.match(booksSource, /useDrawerPanelTransition\(isAnnotationsDrawerOpen\)/)
  assert.match(booksSource, /ref=\{tocDrawerPanelRef\}/)
  assert.match(booksSource, /ref=\{annotationsDrawerPanelRef\}/)
  assert.match(
    booksStyles,
    /grid-template-columns var\(--drawer-panel-exit-duration\)\s+var\(--drawer-panel-motion-ease\)/,
  )
  assert.match(chatWorkspaceSource, /useDrawerPanelTransition\(showRunInspector\)/)
  assert.match(chatWorkspaceSource, /ref=\{runInspectorPanelRef\}/)
  assert.match(globalStyles, /--drawer-panel-enter-duration:\s*660ms/)
  assert.match(globalStyles, /--drawer-panel-exit-duration:\s*440ms/)
})

test('dialogs and toast messages remain present for exit motion', () => {
  assert.match(dialogSource, /playDetachedExitAnimation/)
  assert.match(dialogSource, /isClosing \? ' is-closing'/)
  assert.match(statusbarSource, /setRenderedToast\(null\)/)
  assert.match(statusbarSource, /isToastVisible \? 'is-visible' : 'is-closing'/)
  assert.match(globalStyles, /\.dialog-overlay\.is-closing/)
  assert.match(globalStyles, /\.toast-notification\.is-closing/)
  assert.match(appStoreSource, /get\(\)\.toastId === toastId/)
})

test('primary tab panels animate when their active key changes', () => {
  assert.match(tasksSource, /key=\{taskTab\} className="task-content tab-panel-transition"/)
  assert.match(videosSource, /key=\{activeVideoWorkspace\}[\s\S]*className="tab-panel-transition"/)
  assert.match(toolboxSource, /key=\{toolTab\} className="toolbox-view__body tab-panel-transition"/)
  assert.match(globalStyles, /\.tab::after\s*\{[\s\S]*?transform:\s*scaleX\(0\)/)
  assert.match(globalStyles, /\.tab\.active::after\s*\{[\s\S]*?transform:\s*scaleX\(1\)/)
  assert.match(globalStyles, /@keyframes tab-panel-enter[\s\S]*?translate3d\(0, 8px, 0\) scale\(0\.988\)/)
})

test('global motion polish covers menus, dropdowns, navigation, and screen transitions', () => {
  assert.match(globalStyles, /--ease-fluid:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\)/)
  assert.match(globalStyles, /body\.engine-popmotion\s*\{[\s\S]*?--ease-standard:\s*var\(--ease-elastic\)/)
  assert.match(globalStyles, /body\.motion-expressive\s*\{[\s\S]*?--screen-enter-distance:\s*20px/)
  assert.match(globalStyles, /\.nav-item::after\s*\{[\s\S]*?var\(--interactive-sheen-color\)/)
  assert.match(globalStyles, /\.global-search-btn:hover,[\s\S]*?\.global-search-btn:focus-visible\s*\{[\s\S]*?scale\(var\(--interactive-pop-scale\)\)/)
  assert.match(globalStyles, /\.dropdown__menu\s*\{[\s\S]*?animation:\s*dropdown-menu-enter/)
  assert.match(globalStyles, /@keyframes dropdown-menu-enter[\s\S]*?var\(--dropdown-menu-distance\)[\s\S]*?var\(--dropdown-menu-scale\)/)
  assert.match(globalStyles, /@keyframes screen-enter[\s\S]*?scale\(var\(--screen-enter-scale\)\)/)
  assert.match(globalStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dropdown__menu,[\s\S]*?\.sidebar-display-menu__panel[\s\S]*?animation:\s*none/)
})
