import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')
const approval = readFileSync(path.resolve('src/views/ai/ToolApprovalDialog.tsx'), 'utf8')
const viewer = readFileSync(path.resolve('src/views/ai/MediaViewer.tsx'), 'utf8')
const images = readFileSync(path.resolve('src/views/ai/ImageMessage.tsx'), 'utf8')
const videos = readFileSync(path.resolve('src/views/ai/VideoMessage.tsx'), 'utf8')
const dialog = readFileSync(path.resolve('src/components/AccessibleDialog.tsx'), 'utf8')
const conversationDelete = readFileSync(path.resolve('src/views/ai/ConversationDeleteDialog.tsx'), 'utf8')
const conversationRename = readFileSync(path.resolve('src/views/ai/ConversationRenameDialog.tsx'), 'utf8')
const conversationList = readFileSync(path.resolve('src/views/ai/ConversationList.tsx'), 'utf8')
const providerManager = readFileSync(path.resolve('src/views/ai/ProviderManager.tsx'), 'utf8')
const modelManager = readFileSync(path.resolve('src/views/ai/ModelManager.tsx'), 'utf8')
const agentManager = readFileSync(path.resolve('src/views/ai/AgentManager.tsx'), 'utf8')
const mcpManager = readFileSync(path.resolve('src/views/ai/McpManager.tsx'), 'utf8')
const messageRenderer = readFileSync(path.resolve('src/views/ai/MessageRenderer.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const appCss = readFileSync(path.resolve('src/index.css'), 'utf8')

test('tool approval and media viewer trap focus, close with Escape, and restore focus', () => {
  assert.match(approval, /<AccessibleDialog[\s\S]*role="alertdialog"[\s\S]*returnFocus=\{returnFocus\}[\s\S]*initialFocusRef=\{rejectRef\}/)
  assert.match(viewer, /<AccessibleDialog[\s\S]*returnFocus=[\s\S]*initialFocusRef=\{closeRef\}/)
  assert.match(dialog, /event\.key === 'Escape'[\s\S]*latestOnCloseRef\.current\(\)/)
  assert.match(dialog, /getTrappedFocusIndex[\s\S]*items\[nextIndex\]\.focus\(\)/)
  assert.match(dialog, /queueMicrotask\(\(\) =>[\s\S]*shouldRestoreDialogFocus\(mountedContent\)[\s\S]*latestReturnFocusRef\.current\?\.\(\)/)
  assert.match(workspace, /returnFocus=\{\(\) => textareaRef\.current\?\.focus\(\)\}/)
})

test('conversation deletion uses one explicit dialog and keeps cancel separate from media cleanup', () => {
  assert.doesNotMatch(workspace, /window\.confirm\(t\('aiChat\.chat\.delete/)
  assert.match(workspace, /<ConversationDeleteDialog[\s\S]*onCancel=[\s\S]*onConfirm=/)
  assert.match(conversationDelete, /type="checkbox"[\s\S]*deleteMedia/)
  assert.match(conversationDelete, /className="btn danger"[\s\S]*common\.delete/)
  assert.match(conversationDelete, /role="alertdialog"[\s\S]*overlayClassName="ai-conversation-dialog-overlay"/)
  assert.match(conversationDelete, /closeOnOverlay/)
  assert.match(css, /\.ai-conversation-dialog-overlay\s*\{[\s\S]*z-index:\s*2400/)
  assert.doesNotMatch(css, /\.ai-conversation-delete\s*\{[\s\S]*position:\s*fixed/)
})

test('conversation rename uses an in-app dialog and restores the action trigger', () => {
  assert.doesNotMatch(workspace, /window\.prompt/)
  assert.match(workspace, /<ConversationRenameDialog[\s\S]*returnFocus=\{restoreConversationActionFocus\}/)
  assert.match(conversationRename, /initialFocusRef=\{inputRef\}/)
  assert.match(conversationRename, /closeOnOverlay/)
  assert.match(conversationList, /onRename\(conversation, event\.currentTarget\)/)
  assert.match(conversationList, /onDelete\(conversation, event\.currentTarget\)/)
})

test('completed responses describe retry behavior as sending the prompt again', () => {
  assert.match(messageRenderer, /message\.status === 'completed' \? 'aiChat\.chat\.send_again'/)
  assert.doesNotMatch(messageRenderer, /aiChat\.chat\.regenerate/)
})

test('streaming updates announce run status atomically instead of every token', () => {
  assert.doesNotMatch(workspace, /className="ai-message-timeline"[\s\S]{0,260}aria-live=/)
  assert.match(workspace, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(workspace, /setTimeout\(\(\) =>[\s\S]*announcement_\$\{status\}[\s\S]*}, 240\)/)
  assert.match(workspace, /\[activeRun\?\.runId, activeRun\?\.status, t\]/)
})

test('generated images and videos always expose localized accessible names', () => {
  assert.match(images, /aria-label=\{t\('aiChat\.images\.open_name'/)
  assert.match(images, /alt=\{image\.alt \?\? image\.name \?\? t\('aiChat\.images\.generated_alt'\)\}/)
  assert.match(viewer, /aiChat\.images\.generated_alt/)
  assert.match(videos, /aria-label=\{video\.alt \?\? video\.name \?\? t\('aiChat\.videos\.generated_alt'\)\}/)
})

test('AI controls and run states retain visible keyboard focus and theme-derived contrast', () => {
  assert.match(css, /\.ai-chat-shell :is\(button, a, input, select, textarea, \[tabindex\]\):focus-visible[\s\S]*outline:\s*1px solid/)
  assert.match(css, /\.ai-chat-composer textarea:focus-visible[\s\S]*outline:\s*0/)
  assert.match(css, /\.ai-chat-stage__controls select:focus-visible[\s\S]*outline:\s*0/)
  assert.match(css, /--ai-status-success:[\s\S]*--ai-status-warning:[\s\S]*--ai-status-danger:/)
  assert.match(css, /dd\.is-completed[\s\S]*var\(--ai-status-success\)/)
  assert.match(css, /dd\.is-cancelled,[\s\S]*dd\.is-interrupted[\s\S]*var\(--ai-status-warning\)/)
})

test('media mode controls explain missing providers instead of silently disabling clicks', () => {
  assert.match(workspace, /setNotice\(t\('aiChat\.images\.provider_required_action'\)\)/)
  assert.match(workspace, /setNotice\(t\('aiChat\.videos\.provider_required_action'\)\)/)
  assert.match(workspace, /aria-pressed=\{imageMode\}/)
  assert.match(workspace, /aria-pressed=\{videoMode\}/)
  assert.doesNotMatch(workspace, /disabled=\{!activeAgent\?\.providers\.(?:image|video)/)
  assert.match(workspace, /aiChat\.images\.composer_placeholder/)
  assert.match(workspace, /aiChat\.videos\.composer_placeholder/)
})

test('screen-reader labels stay visually hidden and the run inspector overlays every layout', () => {
  assert.match(appCss, /\.sr-only\s*\{[\s\S]*position:\s*absolute[\s\S]*clip:\s*rect\(0, 0, 0, 0\)/)
  assert.match(workspace, /ref=\{runInspectorToggleRef\}[\s\S]*className="ai-run-inspector-toggle"[\s\S]*aria-controls="ai-run-inspector"/)
  assert.match(workspace, /id="ai-run-inspector"[\s\S]*showRunInspector \? 'is-open'/)
  assert.match(css, /\.ai-chat-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(220px, 250px\) minmax\(0, 1fr\)/)
  assert.match(css, /\.ai-run-inspector-toggle\s*\{[\s\S]*display:\s*inline-flex/)
  assert.match(css, /\.ai-run-inspector\s*\{[\s\S]*display:\s*none/)
  assert.match(css, /\.ai-run-inspector\.is-open[\s\S]*position:\s*absolute[\s\S]*display:\s*flex/)
  assert.match(css, /\.ai-run-inspector__close\s*\{[\s\S]*display:\s*grid/)
  assert.match(workspace, /const closeRunInspector = useCallback[\s\S]*runInspectorToggleRef\.current\?\.focus\(\)/)
  assert.match(workspace, /event\.key !== 'Escape'[\s\S]*closeRunInspector\(\)/)
})

test('accessible dialogs stay fixed to the viewport and lock document scrolling', () => {
  assert.match(dialog, /lockDocumentScroll\(\)/)
  assert.match(dialog, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(appCss, /\.dialog-overlay\s*\{[\s\S]*position:\s*fixed[\s\S]*inset:\s*0[\s\S]*place-items:\s*center/)
  assert.match(appCss, /\.dialog-surface\s*\{[\s\S]*max-height:\s*calc\(100vh - 48px\)[\s\S]*overflow:\s*auto/)
})

test('provider creation uses a full-height settings drawer with focus restoration', () => {
  assert.match(providerManager, /overlayClassName="ai-settings-drawer-overlay"/)
  assert.match(providerManager, /contentClassName="ai-settings-drawer ai-settings-drawer--provider"/)
  assert.match(providerManager, /returnFocus=\{\(\) => drawerTriggerRef\.current\?\.focus\(\)\}/)
  assert.match(providerManager, /closeOnOverlay/)
  assert.match(css, /\.ai-settings-drawer-overlay\s*\{[\s\S]*place-items:\s*stretch end[\s\S]*padding:\s*0/)
  assert.match(css, /\.ai-settings-drawer\s*\{[\s\S]*height:\s*100vh[\s\S]*overflow:\s*hidden/)
  assert.match(css, /\.ai-settings-drawer--provider\s*\{[\s\S]*width:\s*min\(600px, 100vw\)/)
  assert.match(css, /\.ai-settings-drawer \.ai-provider-form__actions\s*\{[\s\S]*position:\s*sticky[\s\S]*bottom:\s*0/)
})

test('provider actions explain themselves and editor controls retain safe close and credential cues', () => {
  assert.match(providerManager, /title=\{t\('aiChat\.providers\.edit_name'/)
  assert.match(providerManager, /title=\{t\('aiChat\.providers\.copy_name'/)
  assert.match(providerManager, /title=\{t\(provider\.enabled \? 'aiChat\.providers\.disable_name'/)
  assert.match(providerManager, /title=\{t\('aiChat\.providers\.delete_name'/)
  assert.match(providerManager, /editing\?\.credentialConfigured \? '\*{8}'/)
  assert.doesNotMatch(providerManager, /onMouseDown=\{handleDrawerClose\}/)
  assert.doesNotMatch(modelManager, /onMouseDown=\{handleDrawerClose\}/)
  assert.doesNotMatch(providerManager, /stopPropagation\(\)/)
  assert.doesNotMatch(modelManager, /stopPropagation\(\)/)
  assert.match(providerManager, /onClick=\{handleDrawerClose\}/)
  assert.match(modelManager, /onClick=\{handleDrawerClose\}/)
  assert.match(css, /\.ai-settings-drawer__title > button\s*\{[\s\S]*width:\s*40px[\s\S]*height:\s*40px[\s\S]*border-radius:\s*0/)
  assert.match(css, /\.ai-settings-drawer__title > button::before\s*\{[\s\S]*inset:\s*4px[\s\S]*border-radius:\s*8px/)
  assert.match(css, /\.ai-settings-drawer__title > button > svg\s*\{[\s\S]*pointer-events:\s*none/)
})

test('provider creation selects catalog models from one flat list and does not create Agents', () => {
  assert.match(providerManager, /catalogModels\.map\(\(model\)/)
  assert.doesNotMatch(providerManager, /catalogModels\.filter\(\(model\) => model\.capabilities\.includes\(kind\)\)/)
  assert.match(providerManager, /type="checkbox" checked=\{selected\}/)
  assert.match(providerManager, /const plural = `\$\{kind\}Models`/)
  assert.match(providerManager, /className="ai-provider-model-catalog"/)
  assert.match(providerManager, /default_model/)
  assert.doesNotMatch(providerManager, /PROVIDER_AGENT_PRESETS|createAIAgent|ai-provider-agent-picker/)
})

test('provider and model editors separate connection settings from the model catalog', () => {
  assert.match(providerManager, /api\.listAIModels/)
  assert.match(providerManager, /imageModels/)
  assert.match(providerManager, /videoModels/)
  assert.doesNotMatch(modelManager, /className="ai-model-capability-grid"/)
  assert.match(modelManager, /aiChat\.models\.all_models/)
  assert.match(modelManager, /aria-label=\{t\('aiChat\.models\.capability_filter'\)\}/)
  assert.match(modelManager, /api\.createAIModel/)
  assert.match(modelManager, /api\.updateAIModel/)
  assert.match(modelManager, /type="checkbox" value=\{capability\}/)
  assert.match(modelManager, /draft\.capabilities\.includes\(capability\)/)
  assert.doesNotMatch(modelManager, /providerName|setDefaultAIProvider/)
  assert.doesNotMatch(modelManager, /ai-model-form__intro/)
  assert.match(modelManager, /api\.syncAIModels/)
  assert.match(css, /\.ai-model-toolbar > select\s*\{[\s\S]*min-height:\s*38px/)
})

test('model switching only changes the model used by the next run', () => {
  const modelChangeHandler = workspace.match(/const handleModelChange = \(agentId: number\) => \{[\s\S]*?\n {2}\}\n\n {2}const handleProviderChange/)?.[0] ?? ''
  assert.match(modelChangeHandler, /setSelectedAgentId\(agentId\)/)
  assert.match(workspace, /const agentId = selectedAgentId/)
  assert.doesNotMatch(modelChangeHandler, /deleteAIConversation/)
  assert.doesNotMatch(modelChangeHandler, /createConversation/)
})

test('model switching adds a deferred timeline divider after the active round', () => {
  assert.match(workspace, /type ModelSwitchMarker = \{[\s\S]*fromProvider:[\s\S]*toProvider:[\s\S]*ready: boolean/)
  assert.match(workspace, /const roundActive = isRunning \|\| isMediaRunning \|\| submitting/)
  assert.match(workspace, /ready: !roundActive/)
  assert.match(workspace, /disabled=\{providerOptions\.length === 0\}/)
  assert.match(workspace, /disabled=\{providerModels\.length === 0\}/)
  assert.match(workspace, /marker\.conversationId === activeConversationId && !marker\.ready \? \{ \.\.\.marker, ready: true \}/)
  assert.match(workspace, /className="ai-model-switch-divider" role="separator"/)
  assert.match(css, /\.ai-model-switch-divider\s*\{[\s\S]*grid-template-columns:[\s\S]*color:/)
  assert.match(css, /\.ai-model-switch-divider::before,[\s\S]*\.ai-model-switch-divider::after[\s\S]*height:\s*1px/)
})

test('model switch dividers persist as conversation events without entering message history', () => {
  assert.match(workspace, /api\.listAIConversationEvents\(conversationId\)/)
  assert.match(workspace, /api\.upsertAIModelSwitchEvent\(\{/)
  assert.match(workspace, /api\.deleteAIModelSwitchEvent\(latest\.conversationId, latest\.afterMessageId\)/)
  assert.match(workspace, /event\.eventType === 'model_switch'/)
  assert.match(workspace, /setSelectedAgentId\(latestTargetAgentId\)/)
})

test('agent creation reuses the settings drawer and returns focus to its trigger', () => {
  assert.match(agentManager, /overlayClassName="ai-settings-drawer-overlay"/)
  assert.match(agentManager, /contentClassName="ai-settings-drawer ai-settings-drawer--agent"/)
  assert.match(agentManager, /returnFocus=\{\(\) => drawerTriggerRef\.current\?\.focus\(\)\}/)
  assert.match(agentManager, /closeOnOverlay/)
  assert.match(css, /\.ai-settings-drawer--agent\s*\{[\s\S]*width:\s*min\(700px, 100vw\)/)
  assert.match(css, /\.ai-settings-drawer \.ai-provider-form,[\s\S]*\.ai-settings-drawer \.ai-agent-form,[\s\S]*\.ai-settings-drawer \.ai-mcp-form\s*\{[\s\S]*flex:\s*1/)
})

test('MCP creation uses the shared drawer without changing transport logic', () => {
  assert.match(mcpManager, /overlayClassName="ai-settings-drawer-overlay"/)
  assert.match(mcpManager, /contentClassName="ai-settings-drawer ai-settings-drawer--mcp"/)
  assert.match(mcpManager, /returnFocus=\{\(\) => drawerTriggerRef\.current\?\.focus\(\)\}/)
  assert.match(mcpManager, /changeTransport\(event\.target\.value as McpDraft\['transport'\]\)/)
  assert.match(css, /\.ai-settings-drawer--mcp\s*\{[\s\S]*width:\s*min\(680px, 100vw\)/)
  assert.match(css, /\.ai-settings-drawer \.ai-agent-form,[\s\S]*\.ai-settings-drawer \.ai-mcp-form\s*\{[\s\S]*flex:\s*1/)
})

test('daily chat typography and action targets remain readable', () => {
  assert.match(css, /\.ai-message__body\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(css, /\.ai-chat-composer textarea\s*\{[\s\S]*font-size:\s*13px/)
  assert.match(css, /\.ai-conversation-item__actions button\s*\{[\s\S]*width:\s*32px[\s\S]*height:\s*32px/)
  assert.match(css, /\.ai-chat-composer__mode button\s*\{[\s\S]*min-height:\s*32px/)
})

test('chat timeline uses compact document-like assistant messages without shrinking user bubbles', () => {
  assert.match(css, /\.ai-message-timeline\s*\{[\s\S]*padding:\s*14px clamp\(14px, 3vw, 36px\) 18px/)
  assert.match(css, /\.ai-message\s*\{[\s\S]*margin:\s*0 auto 11px/)
  assert.match(css, /\.ai-message:not\(\.ai-message--user\) \.ai-message__body\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent/)
  assert.match(css, /\.ai-message--user\s*\{[\s\S]*width:\s*min\(72%, 560px\)/)
  assert.match(css, /\.ai-message__actions\s*\{[\s\S]*min-height:\s*22px/)
  assert.match(css, /\.ai-chat-composer textarea\s*\{[\s\S]*min-height:\s*46px/)
})

test('streamed Markdown is rendered as one continuous response and every selector is fully clickable', () => {
  assert.match(messageRenderer, /function joinConsecutiveMarkdownParts/)
  assert.match(messageRenderer, /message\.parts\[index - 1\]\?\.type === 'markdown'\) return null/)
  assert.match(messageRenderer, /renderAIMessageMarkdown\(joinConsecutiveMarkdownParts\(message\.parts, index\)\)/)
  assert.match(css, /\.ai-message\s*\{[\s\S]*width:\s*min\(100%, 960px\)/)
  assert.match(css, /\.ai-message__markdown\s*\{[\s\S]*overflow-wrap:\s*break-word[\s\S]*word-break:\s*normal/)
  assert.match(css, /\.ai-chat-stage__controls select\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0[\s\S]*width:\s*100% !important[\s\S]*cursor:\s*pointer/)
  assert.match(workspace, /className="ai-chat-stage__selector-value"/)
})
