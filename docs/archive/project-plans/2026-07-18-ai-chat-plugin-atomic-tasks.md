# LifeOS AI 对话插件原子任务清单

日期：2026-07-18

状态：执行中

需求基线：`docs/archive/product/2026-07-18-ai-chat-plugin-product-design-spec.md`

工作计划：`docs/archive/project-plans/2026-07-18-ai-chat-plugin-implementation-work-plan.md`

执行分支：`codex/ai-chat-plugin`

## 一、任务状态规则

- 待开始：尚未修改代码。
- 进行中：当前唯一允许修改的任务。
- 验证中：实现完成，正在执行测试和回归。
- 已完成：测试通过并已独立提交。
- 阻塞：缺少外部输入且安全替代验证无法覆盖。

任何时刻最多一个任务处于“进行中”或“验证中”。

## 二、任务总览

| 编号 | 任务 | 阶段 | 依赖 | 初始状态 |
| --- | --- | --- | --- | --- |
| AT-01 | AI 领域类型、状态机与运行时校验 | A | 无 | 待开始 |
| AT-02 | `ai.db` schema 与幂等迁移 | A | AT-01 | 待开始 |
| AT-03 | safeStorage 凭据服务 | A | AT-01 | 待开始 |
| AT-04 | 模型供应商配置服务与列表规则 | A | AT-02、AT-03 | 待开始 |
| AT-05 | Agent 配置服务与依赖约束 | A | AT-02、AT-04 | 待开始 |
| AT-06 | MCP 配置服务与风险策略 | A | AT-02、AT-03 | 待开始 |
| AT-07 | 配置 IPC 与 preload 安全桥接 | A | AT-04、AT-05、AT-06 | 待开始 |
| AT-08 | 工具箱 AI 入口与独立工作区壳层 | B | AT-07 | 待开始 |
| AT-09 | 模型供应商列表与编辑界面 | B | AT-08 | 待开始 |
| AT-10 | Agent 管理界面 | B | AT-08、AT-09 | 待开始 |
| AT-11 | MCP 管理与连接诊断界面 | B | AT-08 | 待开始 |
| AT-12 | 会话、消息与运行记录服务 | B | AT-02 | 待开始 |
| AT-13 | OpenAI-compatible 流式适配器 | B | AT-01、AT-04 | 待开始 |
| AT-14 | 文本 Agent 运行器与取消机制 | B | AT-05、AT-12、AT-13 | 待开始 |
| AT-15 | 对话工作区、历史、流式与重试 UI | B | AT-08、AT-12、AT-14 | 待开始 |
| AT-16 | MCP HTTP/SSE/stdio 连接管理器 | C | AT-06 | 待开始 |
| AT-17 | 工具调用循环、授权与工具消息 UI | C | AT-14、AT-15、AT-16 | 待开始 |
| AT-18 | AI 媒体存储与安全资源协议 | D | AT-02 | 待开始 |
| AT-19 | 图片生成适配与对话展示 | D | AT-15、AT-18 | 待开始 |
| AT-20 | 视频任务状态机与供应商适配 | D | AT-14、AT-18 | 待开始 |
| AT-21 | 视频下载、转码、封面与对话播放 | D | AT-15、AT-18、AT-20 | 待开始 |
| AT-22 | 任务恢复、容量清理与备份边界 | E | AT-12、AT-18、AT-20 | 待开始 |
| AT-23 | 首次引导、响应式与 GSAP 动效 | E | AT-09、AT-10、AT-11、AT-15 | 待开始 |
| AT-24 | 国际化、键盘与无障碍收口 | E | AT-23 | 待开始 |
| AT-25 | 安全、集成、跨模块与打包验收 | E | AT-01 至 AT-24 | 待开始 |

## 三、原子任务详情

### AT-01 AI 领域类型、状态机与运行时校验

状态：待开始

目标：建立不依赖 UI、数据库或供应商 SDK 的稳定领域模型。

范围：

- 供应商能力、Agent、MCP、会话、消息、内容块、运行、工具调用和媒体任务类型。
- 运行终态：完成、失败、取消、中断。
- 媒体任务状态迁移规则。
- IPC 输入使用的运行时校验器。
- 统一错误码和用户可诊断错误结构。

预计文件：

- 新增 `electron/ai/types.ts`。
- 新增 `electron/ai/validation.ts`。
- 新增 `electron/ai/state.ts`。
- 新增 `tests/aiValidation.test.ts`。
- 新增 `tests/aiState.test.ts`。

测试：

- 合法/非法配置校验。
- 运行和媒体状态合法迁移。
- 未知字段、空字符串、危险 URL 和越界数字拒绝。

验收：

- 所有后续层共享同一领域类型。
- 非法 IPC 输入在进入服务层前被拒绝。

建议提交：`feat: add AI domain types and validation`

### AT-02 `ai.db` schema 与幂等迁移

状态：待开始

目标：创建独立 AI 数据库并保证已有用户安全升级。

范围：

- providers、agents、agent_mcp_links、mcp_servers。
- conversations、messages、message_parts、runs。
- tool_calls、media_assets、schema_meta。
- 外键、索引、唯一约束和默认供应商约束支持字段。
- 初始化流程接入 `initializeUserDatabase`。

预计文件：

- 新增 `electron/ai/schema.ts`。
- 修改 `electron/db/schema.ts`。
- 新增 `tests/aiSchema.test.mjs`。
- 修改 `scripts/run-tests.mjs` 以便 Electron Node 环境执行 schema 测试。

测试：

- 空目录初始化。
- 重复初始化幂等。
- 老版本增量迁移。
- 外键和唯一约束。
- 用户数据库目录隔离。

验收：

- 不改写现有 tasks、notes、books、videos 和 vault schema。
- 失败迁移不会留下被误认为完成的版本号。

建议提交：`feat: add AI database schema`

### AT-03 safeStorage 凭据服务

状态：待开始

目标：安全保存模型和 MCP 凭据，不依赖密码保险箱解锁。

范围：

- Electron safeStorage 加密、解密和可用性检查。
- 开发/测试环境使用显式注入的加密适配器，不允许生产明文回退。
- 凭据引用、覆盖、删除和内存清理。
- 错误脱敏。

预计文件：

- 新增 `electron/ai/credentialService.ts`。
- 新增 `tests/aiCredentialService.test.ts`。

测试：

- 加密后磁盘内容不包含原始密钥。
- 更新和删除凭据。
- safeStorage 不可用时明确失败。
- 错误和摘要不暴露密钥。

验收：

- Renderer 和普通 `ai.db` 无法读取完整凭据。
- 没有静默明文降级。

建议提交：`feat: secure AI provider credentials`

### AT-04 模型供应商配置服务与列表规则

状态：待开始

目标：完成供应商列表管理的业务层。

范围：

- 创建、编辑、复制、启停、删除、搜索和筛选。
- 文本、图片、视频、流式和工具调用能力。
- 每种能力最多一个默认供应商。
- 连接状态与最近测试时间。
- 删除/停用前依赖检查。
- 返回脱敏摘要，不返回完整 API Key。

预计文件：

- 新增 `electron/ai/providerService.ts`。
- 新增 `tests/aiProviderService.test.mjs`。

测试：

- CRUD、筛选、复制和默认项切换。
- 同能力默认项唯一。
- 有 Agent 依赖时删除受阻。
- 停用后依赖 Agent 标记不可运行。
- 列表响应不含密钥。

验收：

- FR-101 至 FR-111 的服务端规则全部覆盖。

建议提交：`feat: manage AI model providers`

### AT-05 Agent 配置服务与依赖约束

状态：待开始

目标：管理 Agent、供应商引用和 MCP 工具策略。

范围：

- Agent CRUD、复制、默认项和启停。
- 系统提示词、模型参数和上下文策略。
- 文本/图片/视频供应商引用。
- MCP 服务关联、工具白名单/黑名单和审批策略。
- Agent 可运行性检查和配置快照。

预计文件：

- 新增 `electron/ai/agentService.ts`。
- 新增 `tests/aiAgentService.test.mjs`。

测试：

- 引用不存在或停用供应商时不可运行。
- 默认 Agent 唯一与删除保护。
- Agent 快照在原配置修改后保持不变。

验收：

- 会话可以依赖稳定快照，不被后续配置编辑破坏。

建议提交：`feat: manage AI agents`

### AT-06 MCP 配置服务与风险策略

状态：待开始

目标：保存 MCP 配置并计算安全审批策略。

范围：

- HTTP、SSE 和 stdio 配置验证。
- 敏感请求头和环境变量分离到凭据服务。
- 工具风险等级和审批策略。
- 命令、参数、工作目录和超时约束。
- 配置摘要脱敏。

预计文件：

- 新增 `electron/ai/mcpConfigService.ts`。
- 新增 `electron/ai/toolPolicy.ts`。
- 新增 `tests/aiMcpConfigService.test.mjs`。
- 新增 `tests/aiToolPolicy.test.ts`。

测试：

- 协议和命令配置校验。
- 敏感字段不写入普通配置。
- 只读自动、写入/命令确认和逐次确认策略。
- 模型无法动态修改 stdio 命令。

验收：

- 默认策略符合最小权限原则。

建议提交：`feat: add MCP configuration and tool policies`

### AT-07 配置 IPC 与 preload 安全桥接

状态：待开始

目标：让 Renderer 通过窄化 API 管理配置。

范围：

- Provider、Agent、MCP CRUD IPC。
- 列表、依赖摘要和连接测试占位协议。
- 主进程校验、错误序列化和用户切换隔离。
- preload 类型与取消订阅模式。

预计文件：

- 新增 `electron/ai/ipc.ts`。
- 修改 `electron/main.ts`。
- 修改 `electron/preload.ts`。
- 新增 `tests/aiIpcContract.test.ts`。

测试：

- IPC channel 白名单。
- 非法输入拒绝。
- 响应不含完整凭据。
- 不暴露任意 URL、命令或 SQL 调用。

验收：

- Renderer 能完整管理配置，但无法绕过服务规则。

建议提交：`feat: expose safe AI configuration IPC`

### AT-08 工具箱 AI 入口与独立工作区壳层

状态：待开始

目标：增加 AI 对话入口并将 AI UI 从 Toolbox 主文件隔离。

设计预检：

- 随机种子 123。
- 首次引导 Hero：Cinematic Center。
- 字体：Outfit。
- 组件：Inline Typography Images、Horizontal Accordions、Infinite Marquee。
- 动效：Scroll Pinning、Card Stacking。

范围：

- 工具箱增加 AI 对话页签。
- 新增独立 `AIChat` 模块和样式入口。
- 对话、供应商、Agent、MCP 内部导航壳层。
- 加载、错误和无配置状态。
- 页面禁止横向溢出。

预计文件：

- 修改 `src/views/Toolbox.tsx`。
- 新增 `src/views/ai/AIChat.tsx`。
- 新增 `src/views/ai/AIChat.css`。
- 修改中英文 locale。
- 新增 `tests/aiToolboxLocales.test.ts`。

测试：

- 页签文案和条件渲染静态回归。
- 旧工具箱页签仍存在且名称正确。
- AI 模块加载失败隔离。

验收：

- Toolbox 不承载 AI 业务状态。
- 800×600 下可以进入和退出 AI 插件。

建议提交：`feat: add AI chat toolbox workspace`

### AT-09 模型供应商列表与编辑界面

状态：待开始

目标：交付独立供应商管理 UI。

范围：

- 搜索和协议、能力、状态筛选。
- 能力、连接状态、最近测试时间和默认模型摘要。
- 创建、编辑、复制、启停、删除和设置默认项。
- API Key 掩码输入。
- 连接测试结果和依赖保护提示。

预计文件：

- 新增 `src/views/ai/ProviderManager.tsx`。
- 新增 `src/views/ai/providerUtils.ts`。
- 修改 AI 样式和 locale。
- 新增 `tests/aiProviderUtils.test.ts`。
- 新增 `tests/aiProviderLocales.test.ts`。

测试：

- 搜索、筛选、排序和能力摘要纯函数。
- 删除/停用依赖提示。
- 深浅主题按钮对比和禁用状态静态检查。

验收：

- 用户无需修改代码即可管理多个模型供应商。

建议提交：`feat: add AI provider management UI`

### AT-10 Agent 管理界面

状态：待开始

目标：让用户创建和维护可运行 Agent。

范围：

- Agent 列表、创建、编辑、复制、启停和默认项。
- 系统提示词、模型参数和上下文策略。
- 文本/图片/视频供应商选择。
- MCP 关联与审批策略。
- 配置不完整诊断。

预计文件：

- 新增 `src/views/ai/AgentManager.tsx`。
- 新增 `src/views/ai/agentUtils.ts`。
- 修改 AI 样式和 locale。
- 新增 `tests/aiAgentUtils.test.ts`。

测试：

- 表单归一化、依赖摘要和可运行性展示。
- 默认 Agent 删除保护。

验收：

- 新建会话能选择一个可运行 Agent。

建议提交：`feat: add AI agent management UI`

### AT-11 MCP 管理与连接诊断界面

状态：待开始

目标：让用户安全配置 MCP 并理解连接结果。

范围：

- HTTP/SSE/stdio 表单。
- 请求头、环境变量和敏感值编辑。
- 启停、测试连接、工具数量和协议能力摘要。
- 工具风险等级覆盖。
- 命令执行风险提示。

预计文件：

- 新增 `src/views/ai/McpManager.tsx`。
- 新增 `src/views/ai/mcpUtils.ts`。
- 修改 AI 样式和 locale。
- 新增 `tests/aiMcpUtils.test.ts`。

测试：

- 传输方式切换和配置摘要。
- 敏感字段掩码。
- 诊断错误映射。

验收：

- UI 不提供模型可修改的任意命令入口。

建议提交：`feat: add MCP management UI`

### AT-12 会话、消息与运行记录服务

状态：待开始

目标：建立稳定的聊天持久化层。

范围：

- 会话创建、重命名、搜索、置顶、归档和删除。
- 消息及有序内容块写入。
- 运行、工具调用和媒体引用记录。
- 会话 Agent 快照。
- 删除会话与媒体引用策略。

预计文件：

- 新增 `electron/ai/conversationService.ts`。
- 新增 `tests/aiConversationService.test.mjs`。

测试：

- 消息顺序、分页和搜索。
- Agent 快照。
- 运行终态唯一。
- 删除会话时保留/删除媒体两种策略。

验收：

- 应用重启后会话结构可恢复。

建议提交：`feat: persist AI conversations and runs`

### AT-13 OpenAI-compatible 流式适配器

状态：待开始

目标：实现首个可真实使用的文本供应商协议。

范围：

- 请求构造、认证、超时和 AbortSignal。
- SSE/增量响应解析。
- 文本、完成原因、工具调用片段和用量归一化。
- HTTP、认证、模型、限流和格式错误映射。
- 本地 mock server fixture。

预计文件：

- 新增 `electron/ai/providers/openAiCompatible.ts`。
- 新增 `electron/ai/providers/streamParser.ts`。
- 新增 `tests/aiOpenAiCompatible.test.ts`。

测试：

- 分片边界、多个 data 事件和 `[DONE]`。
- 中途取消和超时。
- 401、404、429、500 和非法 JSON。
- 响应内容不泄露认证头。

验收：

- 本地 mock provider 能持续流式输出。

建议提交：`feat: add OpenAI-compatible streaming provider`

### AT-14 文本 Agent 运行器与取消机制

状态：待开始

目标：连接 Agent、历史、供应商和运行状态。

范围：

- 加载 Agent 快照和有效历史。
- 启动运行、接收增量、批量持久化和完成。
- 停止、失败和中断。
- 同会话单前台运行约束。
- 主进程到 Renderer 的运行事件。

预计文件：

- 新增 `electron/ai/agentRuntime.ts`。
- 新增 `electron/ai/runEvents.ts`。
- 扩展 AI IPC 和 preload。
- 新增 `tests/aiAgentRuntime.test.ts`。

测试：

- 正常流、取消、并发拒绝和供应商失败。
- 切换会话后事件仍携带正确 IDs。
- 终态只能写入一次。

验收：

- 用户停止后底层 fetch 真正中止。

建议提交：`feat: run streaming AI conversations`

### AT-15 对话工作区、历史、流式与重试 UI

状态：待开始

目标：交付可日常使用的文本聊天体验。

范围：

- 会话栏、消息时间线、运行检查器和输入区。
- Agent 选择、发送、停止、重试和重新生成。
- Markdown 安全渲染、代码块和复制。
- 用户上滚后的自动滚动控制。
- 长会话分页或虚拟化基础。

预计文件：

- 新增 `src/views/ai/ConversationList.tsx`。
- 新增 `src/views/ai/ChatWorkspace.tsx`。
- 新增 `src/views/ai/MessageRenderer.tsx`。
- 新增 `src/views/ai/chatUtils.ts`。
- 修改 AI 样式、locale 和 IPC 类型。
- 新增 `tests/aiChatUtils.test.ts`。
- 新增 `tests/aiMessageSecurity.test.ts`。

测试：

- 增量合并、滚动跟随和消息排序。
- Markdown 注入清理。
- Enter/Shift+Enter 行为。
- 10 轮 mock 对话集成测试。

验收：

- FR-401 至 FR-509 的文本范围通过。

建议提交：`feat: add streaming AI chat workspace`

### AT-16 MCP HTTP/SSE/stdio 连接管理器

状态：待开始

目标：连接真实 MCP 服务并管理生命周期。

范围：

- 引入 MCP SDK。
- Streamable HTTP、SSE 和 stdio transport。
- 工具发现、缓存、刷新、调用和取消。
- 用户切换、禁用、应用退出时关闭。
- stderr 和协议错误脱敏诊断。

预计文件：

- 修改 `package.json` 和 `package-lock.json`。
- 新增 `electron/ai/mcpManager.ts`。
- 新增测试 MCP fixture/server。
- 新增 `tests/aiMcpManager.test.ts`。

测试：

- HTTP 和 stdio 工具发现与调用。
- 超时、断开、进程退出和重连。
- 命令参数数组化和跨平台路径处理。

验收：

- MCP 进程不会泄漏到用户切换或应用退出之后。

建议提交：`feat: connect MCP servers`

### AT-17 工具调用循环、授权与工具消息 UI

状态：待开始

目标：完成 Agent 调用 MCP 的闭环。

范围：

- 解析供应商工具调用。
- 工具白名单、风险策略和授权等待。
- 执行结果归一化并继续模型请求。
- 最大循环次数、调用超时和取消。
- 工具卡片、授权对话框和结果摘要。

预计文件：

- 新增 `electron/ai/toolLoop.ts`。
- 扩展 `agentRuntime.ts`、AI IPC 和 preload。
- 新增 `src/views/ai/ToolCallCard.tsx`。
- 新增 `src/views/ai/ToolApprovalDialog.tsx`。
- 新增 `tests/aiToolLoop.test.ts`。
- 新增 `tests/aiToolApproval.test.ts`。

测试：

- 只读自动执行。
- 危险工具等待授权。
- 拒绝后继续回答。
- 超时、取消和达到 8 次上限。
- 工具输出过大时摘要化。

验收：

- 模型不能绕过工具策略。

建议提交：`feat: execute MCP tools with approval`

### AT-18 AI 媒体存储与安全资源协议

状态：待开始

目标：为图片和视频建立安全持久化底座。

范围：

- 用户 AI 媒体和临时目录。
- 下载临时文件、校验、原子完成和哈希。
- MIME、大小、扩展名和磁盘空间检查。
- `life-ai-asset:` 协议与 Range 支持。
- SSRF、重定向和路径逃逸防护。

预计文件：

- 新增 `electron/ai/mediaService.ts`。
- 新增 `electron/ai/mediaProtocol.ts`。
- 修改 `electron/main.ts` 和 CSP。
- 新增 `tests/aiMediaSecurity.test.ts`。
- 新增 `tests/aiMediaProtocol.test.ts`。

测试：

- Base64 和 HTTPS 下载。
- localhost/内网/危险协议/重定向拒绝。
- 路径穿越和目录外文件拒绝。
- Range 请求和临时文件清理。

验收：

- Renderer 只接收受控媒体 URL。

建议提交：`feat: store AI media securely`

### AT-19 图片生成适配与对话展示

状态：待开始

目标：在对话内完整显示图片生成结果。

范围：

- 图片能力适配接口。
- Base64、远程 URL、异步任务 ID 和 MCP 图片结果。
- 下载进度、失败重试和去重。
- 单图、多图网格、原图查看、另存和定位。

预计文件：

- 新增 `electron/ai/providers/imageAdapter.ts`。
- 新增 `electron/ai/imageGenerationService.ts`。
- 新增 `src/views/ai/ImageMessage.tsx`。
- 新增 `src/views/ai/MediaViewer.tsx`。
- 新增 `tests/aiImageGeneration.test.ts`。

测试：

- 三种返回形式。
- 临时 URL 下载后失效。
- 重试不产生重复消息。
- 错误 MIME 和解码失败。

验收：

- 图片重启后仍可查看。

建议提交：`feat: display generated images in AI chat`

### AT-20 视频任务状态机与供应商适配

状态：待开始

目标：统一不同视频供应商的异步任务。

范围：

- 创建、排队、生成、下载、处理、完成、失败和取消状态。
- 供应商任务 ID、轮询间隔、退避和超时。
- 任务查询、取消和结果 URL 获取。
- xAI/Grok 等供应商通过适配器注册，不耦合页面。
- 本地异步 mock fixture。

预计文件：

- 新增 `electron/ai/providers/videoAdapter.ts`。
- 新增 `electron/ai/videoGenerationService.ts`。
- 新增 `tests/aiVideoGeneration.test.ts`。

测试：

- 正常完成、排队、限流、失败、取消和超时。
- 应用中断后按任务 ID 恢复查询。
- URL 过期后重新获取。

验收：

- 状态迁移可追溯且不会重复完成。

建议提交：`feat: manage AI video generation jobs`

### AT-21 视频下载、转码、封面与对话播放

状态：待开始

目标：把视频任务结果变成稳定可播放的聊天消息。

范围：

- 下载、校验、时长探测和格式判断。
- 必要时通过现有 FFmpeg 转为兼容格式。
- 生成封面。
- 对话视频卡、进度、播放器、另存和定位。
- 原始文件保留策略。

预计文件：

- 新增 `electron/ai/videoAssetService.ts`。
- 新增 `src/views/ai/VideoMessage.tsx`。
- 复用或抽取现有视频工具支持。
- 新增 `tests/aiVideoAssetService.test.ts`。
- 新增 `tests/aiVideoMessage.test.ts`。

测试：

- 已兼容 MP4 直接播放。
- 不兼容 fixture 进入转码路径。
- 下载失败、FFmpeg 缺失和磁盘不足。
- 本地播放 URL 范围请求。

验收：

- 应用重启后视频仍可播放。

建议提交：`feat: play generated videos in AI chat`

### AT-22 任务恢复、容量清理与备份边界

状态：待开始

目标：补齐长期使用和数据安全闭环。

范围：

- 启动时中断文本任务、恢复可查询媒体任务。
- AI 数据与媒体容量统计。
- 按会话、媒体类型和容量清理。
- 数据库引用与文件删除一致性。
- AI 数据纳入备份 manifest，凭据默认排除。

预计文件：

- 新增 `electron/ai/recoveryService.ts`。
- 新增 `electron/ai/storageService.ts`。
- 修改 `electron/backup/service.ts`。
- 新增 `tests/aiRecovery.test.ts`。
- 修改 `tests/backupService.test.ts`。

测试：

- 重启恢复矩阵。
- 清理引用和孤儿文件。
- 凭据不进入备份。
- 恢复后 schema 和媒体路径正确。

验收：

- 清理或恢复失败不会留下错误完成状态。

建议提交：`feat: recover and manage AI storage`

### AT-23 首次引导、响应式与 GSAP 动效

状态：待开始

目标：实现已批准的首次配置体验，并保证日常工作区克制高效。

范围：

- 引入 GSAP 和 `@gsap/react`。
- Cinematic Center 两行欢迎区。
- 6×2 无空隙 Bento。
- Inline Typography Images、Horizontal Accordions、Infinite Marquee。
- Scroll Pinning 与 Card Stacking，仅用于首次引导。
- 1180、960、800 三档布局。
- 减少动态效果降级。

预计文件：

- 修改 `package.json` 和 `package-lock.json`。
- 新增 `src/views/ai/AIOnboarding.tsx`。
- 扩展 `AIChat.css`。
- 新增 `tests/aiOnboardingLayout.test.ts`。
- 新增 `tests/aiMotionRegression.test.ts`。

测试：

- Bento 单元总数 12，无空单元，dense flow 存在。
- H1 宽度和 2–3 行约束静态检查。
- reduced-motion 不注册非必要 ScrollTrigger。
- 页面无横向滚动。

验收：

- 引导完成后自动进入日常工作区，不重复阻挡用户。

建议提交：`feat: polish AI onboarding and responsive layout`

### AT-24 国际化、键盘与无障碍收口

状态：待开始

目标：让 AI 插件符合现有语言和可访问性基线。

范围：

- 所有中文和英文文案对齐。
- 会话列表、消息区、检查器和对话框焦点顺序。
- Enter、Shift+Enter、Escape 和快捷键。
- 流式消息的 aria-live 节流。
- 媒体替代文本、授权对话框焦点恢复。
- 四套主题对比和状态色。

预计文件：

- 修改 locale、AI 组件和样式。
- 新增 `tests/aiLocales.test.ts`。
- 新增 `tests/aiAccessibility.test.ts`。

测试：

- 中英文键集合一致。
- 按钮可访问名称。
- 对话框焦点与 Escape。
- 流式更新不会逐 token 播报。

验收：

- 800×600、键盘和 reduced-motion 路径可完成首轮对话。

建议提交：`feat: make AI chat accessible and localized`

### AT-25 安全、集成、跨模块与打包验收

状态：待开始

目标：完成最终质量门禁并证明没有干扰现有功能。

范围：

- 全量自动化测试。
- AI 端到端 mock 用户旅程。
- 凭据、SSRF、路径、协议、Markdown 和 MCP 权限专项测试。
- 工具箱、任务、笔记、书库、视频、备份和用户切换回归。
- lint、build、native 和 Windows package 检查。
- macOS 打包应用人工验收记录。
- 需求—实现—验收矩阵。

预计文件：

- 新增或更新集成测试。
- 新增 `docs/archive/qa/2026-07-18-ai-chat-plugin-validation.md`。
- 新增 `docs/archive/product/2026-07-18-ai-chat-plugin-acceptance-matrix.md`。

测试命令：

- `npm test`。
- `npm run lint`。
- `npm run build`。
- `npm run verify:native`。
- `npm run verify:package:win`。
- 必要时 `npm run build:app`。

验收：

- 首版必须项全部可追溯。
- 没有 P0/P1 安全、数据丢失、崩溃或现有模块阻塞问题。
- 所有遗留项有明确范围和原因。

建议提交：`test: validate AI chat plugin end to end`

## 四、每项任务完成记录模板

任务完成后在对应任务下追加：

- 完成状态：已完成。
- 提交：短哈希与提交标题。
- 针对性测试：命令与结果。
- 全量回归：命令与结果。
- 影响检查：确认受影响模块和未发现回归。
- 遗留风险：无，或列出后续任务编号。

## 五、自动推进规则

1. 将下一个依赖已满足的任务标记为进行中。
2. 完成实现与针对性测试。
3. 执行全量测试、lint、build 和 diff 检查。
4. 只暂存该任务文件并提交。
5. 更新完成记录；记录更新可以随下一任务提交，最终验收时统一校对。
6. 自动进入下一个任务，不等待额外确认。
7. 只有遇到需要用户凭据、外部授权或会显著改变范围的决定时才暂停。
