import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const notesSource = readFileSync(new URL('../src/views/Notes.tsx', import.meta.url), 'utf8')
const notesCss = readFileSync(new URL('../src/views/Notes.css', import.meta.url), 'utf8')

test('markdown notes support pasted images, attached files, and secure preview links', () => {
  assert.match(notesSource, /onPaste=\{\(event\) => void handleEditorPaste\(event\)\}/)
  assert.match(notesSource, /selectNoteAttachments/)
  assert.match(notesSource, /saveNotePastedImage/)
  assert.match(notesSource, /openNoteAttachment/)
  assert.match(notesSource, /life-note-asset:\/\/attachment/)
})

test('note images can persist dimensions and be resized in the preview', () => {
  assert.match(notesSource, /updateNoteImageDimensionsInContent/)
  assert.match(notesSource, /renderSizedNoteImages/)
  assert.match(notesSource, /pointerdown/)
  assert.match(notesSource, /note-image-resize-handle/)
  assert.match(notesSource, /note-image-resize-guide/)
  assert.match(notesSource, /currentWidth/)
  assert.match(notesSource, /frame\.style\.width/)
  assert.match(notesSource, /requestAnimationFrame/)
  const pointerMoveBody = notesSource.slice(
    notesSource.indexOf('const handlePointerMove'),
    notesSource.indexOf('const handlePointerUp'),
  )
  assert.doesNotMatch(pointerMoveBody, /setSelectedNoteImage/)
  assert.doesNotMatch(pointerMoveBody, /applyImageDimensions/)
  assert.match(pointerMoveBody, /scheduleImageResizeGuidePaint/)
  assert.match(notesCss, /\.note-image-resize-guide/)
  assert.match(notesSource, /image_resize_hint/)
})

test('note editor keeps narrow toolbars compact and defers expensive preview work', () => {
  assert.match(notesSource, /useDeferredValue/)
  assert.match(notesSource, /deferredNoteContent/)
  assert.match(notesSource, /renderedMarkdownHtml/)
  assert.match(notesSource, /isMarkdownRendering/)
  assert.match(notesSource, /requestIdleCallback/)
  assert.match(notesSource, /note-render-loading/)
  assert.match(notesSource, /420/)
  assert.match(notesSource, /note-view-mode-label/)
  assert.match(notesSource, /note-editor-action-label/)
  assert.match(notesCss, /container-name:\s*notes-editor-header/)
  assert.match(notesCss, /@container notes-editor-header \(max-width: 820px\)/)
  assert.match(notesCss, /\.notes-editor-actions \.btn:hover:not\(:disabled\)/)
  assert.match(notesCss, /transform:\s*none/)
  assert.match(notesCss, /\.notes-editor-title-input[\s\S]*text-overflow:\s*ellipsis/)
  assert.match(notesCss, /\.notes-editor-actions[\s\S]*flex:\s*0 0 auto/)
  assert.match(notesSource, /renderImageSizeControls\(\)/)
})

test('clicking editable note content slides the notebook sidebar closed', () => {
  assert.match(notesSource, /const hideNotebookSidebarForEditing = useCallback/)
  assert.equal(
    notesSource.match(/onPointerDown=\{hideNotebookSidebarForEditing\}/g)?.length,
    2,
  )
  assert.match(notesCss, /transition:\s*grid-template-columns/)
  assert.match(
    notesCss,
    /\.notes-workspace--sidebar-closed \.notebook-sidebar[\s\S]*transform:\s*translateX\(-100%\)/,
  )
})

test('main note view is suspended while popup editing is active', () => {
  assert.match(notesSource, /isMainNoteRenderSuspended/)
  assert.match(notesSource, /pendingExternalEditorDraftRef/)
  assert.match(notesSource, /popup_editor_active_title/)
  assert.match(notesSource, /popup_editor_restoring_title/)
  assert.match(notesSource, /setIsEditorWindowOpen\(true\)/)
  assert.match(notesSource, /setIsEditorWindowOpen\(false\)/)
  assert.match(notesCss, /\.notes-external-editor-state/)
})
