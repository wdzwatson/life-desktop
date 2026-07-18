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
| AT-01 | AI 领域类型、状态机与运行时校验 | A | 无 | 已完成 |
| AT-02 | `ai.db` schema 与幂等迁移 | A | AT-01 | 已完成 |
| AT-03 | safeStorage 凭据服务 | A | AT-01 | 已完成 |
| AT-04 | 模型供应商配置服务与列表规则 | A | AT-02、AT-03 | 已完成 |
| AT-05 | Agent 配置服务与依赖约束 | A | AT-02、AT-04 | 已完成 |
| AT-06 | MCP 配置服务与风险策略 | A | AT-02、AT-03 | 已完成 |
| AT-07 | 配置 IPC 与 preload 安全桥接 | A | AT-04、AT-05、AT-06 | 已完成 |
| AT-08 | 工具箱 AI 入口与独立工作区壳层 | B | AT-07 | 已完成 |
| AT-09 | 模型供应商列表与编辑界面 | B | AT-08 | 已完成 |
| AT-10 | Agent 管理界面 | B | AT-08、AT-09 | 已完成 |
| AT-11 | MCP 管理与连接诊断界面 | B | AT-08 | 已完成 |
| AT-12 | 会话、消息与运行记录服务 | B | AT-02 | 已完成 |
| AT-13 | OpenAI-compatible 流式适配器 | B | AT-01、AT-04 | 已完成 |
| AT-14 | 文本 Agent 运行器与取消机制 | B | AT-05、AT-12、AT-13 | 已完成 |
| AT-15 | 对话工作区、历史、流式与重试 UI | B | AT-08、AT-12、AT-14 | 已完成 |
| AT-16 | MCP HTTP/SSE/stdio 连接管理器 | C | AT-06 | 已完成 |
| AT-17 | 工具调用循环、授权与工具消息 UI | C | AT-14、AT-15、AT-16 | 已完成 |
| AT-18 | AI 媒体存储与安全资源协议 | D | AT-02 | 已完成 |
| AT-19 | 图片生成适配与对话展示 | D | AT-15、AT-18 | 已完成 |
| AT-20 | 视频任务状态机与供应商适配 | D | AT-14、AT-18 | 已完成 |
| AT-21 | 视频下载、转码、封面与对话播放 | D | AT-15、AT-18、AT-20 | 已完成 |
| AT-22 | 任务恢复、容量清理与备份边界 | E | AT-12、AT-18、AT-20 | 已完成 |
| AT-23 | 首次引导、响应式与 GSAP 动效 | E | AT-09、AT-10、AT-11、AT-15 | 已完成 |
| AT-24 | 国际化、键盘与无障碍收口 | E | AT-23 | 进行中 |
| AT-25 | 安全、集成、跨模块与打包验收 | E | AT-01 至 AT-24 | 待开始 |

## 三、原子任务详情

### AT-01 AI 领域类型、状态机与运行时校验

状态：已完成

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

完成记录：

- 针对性测试：`npx tsx --test tests/aiState.test.ts tests/aiValidation.test.ts`，12 项通过。
- 全量回归：`npm test`，AI 测试与既有测试全部通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 影响检查：本任务未接入数据库、IPC 或 UI，未改变现有模块运行路径。
- 遗留风险：无，数据库落地由 AT-02 处理。

### AT-02 `ai.db` schema 与幂等迁移

状态：已完成

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

完成记录：

- 针对性测试：Electron Node 环境执行 `tests/aiSchema.test.mjs`，5 项通过。
- 全量回归：`npm test`，主测试、AI schema、事务、保险箱和视频 schema 测试全部通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 影响检查：仅新增独立 `ai.db` 并接入用户数据库初始化；现有数据库 schema 测试保持通过。
- 遗留风险：凭据引用字段尚未接入加密服务，由 AT-03 处理。

### AT-03 safeStorage 凭据服务

状态：已完成

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

完成记录：

- 针对性测试：`npx tsx --test tests/aiCredentialService.test.ts`，6 项通过。
- 全量回归：`npm test`，270 项主测试及数据库专项测试全部通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，Electron safeStorage 适配器可正常打包。
- 影响检查：凭据服务尚未接入现有页面或保险箱，不改变现有认证与保险箱行为。
- 遗留风险：供应商与 MCP 配置尚未创建凭据引用，由 AT-04 和 AT-06 接入。

### AT-04 模型供应商配置服务与列表规则

状态：已完成

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

完成记录：

- 针对性测试：Electron Node 环境执行 `tests/aiProviderService.test.mjs`，8 项通过。
- 全量回归：`npm test`，270 项主测试及 AI/事务/保险箱/视频数据库专项测试全部通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 影响检查：供应商逻辑仍位于独立服务层，未接入现有 UI 或网络请求；现有模块路径未改变。
- 遗留风险：Agent 可运行性修复和完整依赖协调由 AT-05 处理。

### AT-05 Agent 配置服务与依赖约束

状态：已完成

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

完成记录：

- 针对性测试：Electron Node 环境执行 `tests/aiAgentService.test.mjs`，8 项通过。
- 全量回归：`npm test`，270 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 影响检查：Agent 服务仅使用独立 AI 表；现有工具箱、用户认证和其他数据库未接入该路径。
- 遗留风险：MCP 的敏感配置、风险覆盖和连接诊断由 AT-06 实现。

### AT-06 MCP 配置服务与风险策略

状态：已完成

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

完成记录：

- 针对性测试：MCP 配置 7 项、工具风险策略 2 项，共 9 项通过。
- 全量回归：`npm test`，272 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 影响检查：MCP 尚未启动子进程或网络连接；当前任务只写独立 AI 配置表和加密凭据。
- 遗留风险：真实 MCP transport 和进程生命周期由 AT-16 实现。

### AT-07 配置 IPC 与 preload 安全桥接

状态：已完成

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

完成记录：

- 针对性测试：`npx tsx --test tests/aiIpcContract.test.ts`，4 项通过。
- 全量回归：`npm test`，276 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，main 与 preload 产物生成成功。
- 影响检查：新增 28 个白名单配置 channel；未暴露凭据读取、运行时 MCP 配置、任意命令或 AI SQL 接口。
- 遗留风险：配置连接测试将在供应商适配器和 MCP transport 完成后接入。

### AT-08 工具箱 AI 入口与独立工作区壳层

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiToolboxLocales.test.ts`，3 项通过。
- 全量回归：`npm test`，279 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，AIChat 生成独立懒加载 JS/CSS chunk。
- 实际渲染：800×600 下标题 2 行、页面和 AI shell 均无横向溢出，内部导航可切换，控制台无错误。
- 影响检查：番茄钟、换算器和保险箱入口保留；AI 加载由错误边界隔离。
- 遗留风险：供应商、Agent、MCP 当前为壳层占位，分别由 AT-09、AT-10、AT-11 接入。

### AT-09 模型供应商列表与编辑界面

状态：已完成

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

完成记录：

- 针对性测试：供应商 UI 工具、双语文案和服务层共 15 项通过。
- 全量回归：`npm test`，286 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，供应商管理随 AIChat 独立懒加载。
- 实际渲染：800×600 下供应商列表、筛选和编辑对话框无横向溢出；多模态能力切换后正确显示文本、图片和视频模型字段。
- 安全检查：API Key 使用掩码输入，列表仅显示凭据是否存在和请求头名称；编辑时默认保留安全存储中的既有请求头。
- 影响检查：全量回归通过，既有工具箱和其他业务模块未发现行为变化。
- 遗留风险：真实网络连接测试由 AT-13 接入；Agent 依赖保护的界面联动由 AT-10 完成。

### AT-10 Agent 管理界面

状态：已完成

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

完成记录：

- 针对性测试：Agent UI 工具、双语文案和服务层共 15 项通过。
- 全量回归：`npm test`，293 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，Agent 管理随 AIChat 独立懒加载。
- 实际渲染：800×600 下完整与不完整 Agent、供应商摘要、MCP 摘要和编辑对话框均无横向溢出。
- 安全检查：默认审批策略为“高风险工具确认”；选择“全部自动执行”时展示显式风险提示；默认 Agent 的停用操作在界面和服务层双重阻止。
- 依赖检查：缺失或停用的供应商/MCP 会显示具体问题并阻止设为默认，模型与 MCP 引用不会静默失效。
- 影响检查：全量回归通过，现有供应商管理和工具箱模块未发现行为变化。
- 遗留风险：MCP 工具发现后的精确工具选择由 AT-16、AT-17 接入；会话内 Agent 选择由 AT-15 接入。

### AT-11 MCP 管理与连接诊断界面

状态：已完成

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

完成记录：

- 针对性测试：MCP UI 工具、双语文案和配置服务共 14 项通过。
- 全量回归：`npm test`，299 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，MCP 管理随 AIChat 独立懒加载。
- 实际渲染：800×600 下 HTTP 与 stdio 列表、连接成功/失败诊断、协议版本、工具数和编辑对话框均无横向溢出。
- 安全检查：请求头与环境变量值不回传渲染层；同传输方式编辑默认保留安全存储凭据，切换传输方式会要求重新填写；stdio 显示本地命令风险提示。
- 权限检查：支持工具风险覆盖；停用前展示受影响 Agent，仍被 Agent 使用时阻止删除。
- 影响检查：全量回归通过，供应商、Agent 和既有工具箱功能未发现行为变化。
- 遗留风险：真实 MCP 握手与“测试连接”按钮由 AT-16 运行时连接管理器启用；当前界面已完整展示服务层保存的连接诊断。

### AT-12 会话、消息与运行记录服务

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiConversationService.test.mjs`，9 项通过。
- 全量回归：`npm test`，299 项主测试及包含会话服务在内的全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 持久化检查：关闭并重新打开 `ai.db` 后，会话、消息与有序内容块完整恢复。
- 状态检查：消息、运行和工具调用终态不可重新打开；Agent 快照按值保存且后续配置变化不会改写历史。
- 安全检查：工具输入和用量数据写库前自动脱敏，媒体来源 URL 去除凭据、查询参数和片段。
- 删除策略：默认保留媒体记录；选择清理时仅删除已失去全部消息与工具调用引用的媒体，并返回待清理文件清单。
- 影响检查：全量回归通过，未新增渲染层接口，也未改变现有配置与业务模块路径。
- 遗留风险：媒体文件的物理删除与容量策略由 AT-18、AT-22 接入；会话 IPC 与 UI 由 AT-14、AT-15 接入。

### AT-13 OpenAI-compatible 流式适配器

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiOpenAiCompatible.test.ts`，6 项通过。
- 全量回归：`npm test`，305 项主测试及全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 流式检查：SSE 支持 UTF-8 分片、多行 data、多个事件和 `[DONE]`，统一输出文本、工具调用增量、用量和完成原因。
- 中止检查：用户取消和超时都会中止底层 fetch/ReadableStream，分别映射为 `cancelled` 与 `timeout`。
- 错误检查：401/403、404、429、5xx、网络中断和非法 JSON 均映射为结构化错误；429 保留可用的重试时间。
- 安全检查：API Key 覆盖同名自定义认证头，但不会进入错误信息；HTTP 错误响应体不会回显到诊断消息。
- 影响检查：适配器不依赖数据库和渲染层，全量回归未发现现有模块行为变化。
- 遗留风险：工具调用分片的合并、会话持久化和运行事件由 AT-14 完成；图片和视频协议由 AT-19、AT-20 分别适配。

### AT-14 文本 Agent 运行器与取消机制

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiAgentRuntime.test.ts` 与 `tests/aiIpcContract.test.ts`，11 项通过；`tests/aiConversationService.test.mjs`，10 项通过。
- 全量回归：`npm test`，312 项主测试及包含会话恢复在内的全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 流式检查：运行器加载 Agent 快照、系统提示词和受上下文上限约束的有效历史，持续发布文本与用量事件，并将多个增量批量写入 Assistant 消息。
- 中止检查：每次运行使用独立 `AbortController`；停止、退出、关闭数据库和切换用户均会中止底层供应商请求，保留已有文本并写入单一终态。
- 恢复检查：应用异常结束后遗留的 queued、running、waiting 状态运行与对应流式消息会在下次运行时幂等恢复为 interrupted。
- 事件检查：所有 Renderer 事件均携带稳定的 conversationId、runId、messageId、递增 sequence 和 timestamp，切换会话不会串流。
- 安全检查：运行 IPC 与配置 IPC 白名单分离；Renderer 只能启动、取消和订阅公开事件，API Key、自定义认证头及工具原始参数不会跨越 preload。
- 影响检查：全量回归通过；未启用 MCP 工具执行，工具循环仍由 AT-16、AT-17 接入。
- 遗留风险：对话历史管理、重试与重新生成 UI 由 AT-15 完成；MCP 工具调用由 AT-16、AT-17 完成。

### AT-15 对话工作区、历史、流式与重试 UI

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiChatUtils.test.ts`、`tests/aiMessageSecurity.test.ts`、`tests/aiIpcContract.test.ts`、`tests/aiToolboxLocales.test.ts` 共 18 项通过；`tests/aiConversationIpc.test.mjs` 与 `tests/aiChatRoundTrip.test.mjs` 共 2 项通过。
- 全量回归：`npm test`，322 项主测试及包含会话 IPC、十轮对话链路在内的全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 会话检查：支持新建、搜索、加载、重命名、置顶、归档、删除与 Markdown/媒体清单导出；删除时可选择保留或清理失去引用的媒体。
- 对话检查：支持 Agent 选择、发送、停止、失败重试、完成后重新生成、50 条分页加载、流式增量批量合并和用户上滚后暂停自动跟随。
- 安全检查：Markdown 经 `marked` 解析后使用严格 DOMPurify 白名单清理，禁止 script、iframe、object、embed、内联事件、style 和未知协议；外部链接交由主进程安全打开。
- 事件检查：Renderer 按 conversationId、runId、messageId 和 sequence 去重，32ms 批量合并文本事件；切换会话时旧请求和旧增量不会覆盖当前时间线。
- 集成检查：十轮 mock 对话完整经过 Agent 运行器、Renderer 消息归并和 `ai.db` 持久化，得到 20 条有序消息与 10 个唯一完成终态。
- 响应式检查：在 800×600 实际页面中无横向或页面级纵向溢出，配置主操作完整可见；供应商页与原有番茄钟切换正常，控制台无错误或警告。
- 影响检查：全量回归通过，AI 会话 IPC 与配置/运行 IPC 继续分离，未改变任务、笔记、书库、视频、凭据库和原有工具箱数据路径。
- 遗留风险：MCP 工具消息与审批 UI 由 AT-16、AT-17 接入；图片和视频内容块当前只显示安全附件摘要，真实资源展示由 AT-18 至 AT-21 完成；引导态 GSAP 动效由 AT-23 完成。

### AT-16 MCP HTTP/SSE/stdio 连接管理器

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiMcpManager.test.mjs`，4 项真实协议测试通过；MCP locale、工具函数与 IPC 契约测试共 13 项通过。
- 全量回归：`npm test`，324 项主测试及包含 MCP 管理器在内的全部数据库专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过，官方 `@modelcontextprotocol/sdk` 1.29.0 已纳入 Electron 主进程构建。
- 传输检查：Streamable HTTP、旧版 HTTP+SSE 和 stdio 均使用真实 SDK server fixture 完成初始化、工具发现和工具调用。
- 生命周期检查：同服务连接去重，支持工具缓存、刷新、断线检测与重连；配置更新、停用、删除、退出、关闭数据库和切换用户时会关闭连接并立即向 stdio 子进程发送终止信号。
- 调用检查：工具调用支持独立 AbortSignal、1 秒超时验证、参数对象大小限制和服务配置超时上限；stdio 命令与参数使用数组直接传递，不经过 Shell，含空格参数保持完整。
- 诊断检查：连接状态、协商协议版本、工具数量、最近成功时间和错误写入 `ai.db`；stderr、认证头、URL 查询密钥和配置环境变量值在持久化前脱敏并限长。
- 安全检查：Renderer 仅能连接、断开和刷新公开工具元数据，没有任意 MCP 工具执行 IPC；敏感 headers/env 只在主进程解密并传给 SDK transport。
- UI 检查：MCP 管理页的“测试连接”已接入真实连接和工具发现，连接后切换为“刷新工具”；失败诊断沿用脱敏状态卡片。
- 影响检查：全量回归通过，未改变现有配置数据格式；新增 SDK 依赖审计结果为 0 个漏洞。
- 遗留风险：工具白名单、风险审批、结果标准化和继续模型循环由 AT-17 完成；OAuth 授权流程不在首版自填 headers/env 范围内。

### AT-17 工具调用循环、授权与工具消息 UI

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiAgentRuntime.test.ts`、`tests/aiToolLoop.test.ts`、`tests/aiToolApproval.test.ts`、`tests/aiChatUtils.test.ts` 与 `tests/aiIpcContract.test.ts` 共 33 项通过。
- 全量回归：`npm test`，338 项主测试及包含 AI schema、供应商、Agent、MCP、会话、十轮对话、事务、保险箱和视频数据库在内的全部专项测试通过；真实 MCP 管理器 5 项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 依赖检查：`npm audit --audit-level=high` 返回 0 个漏洞，`git diff --check` 通过。
- 工具闭环：供应商工具调用分片按索引归并，工具名转换为稳定且不超过 64 字符的安全函数名；执行结果以 `tool` 消息返回模型，模型可继续生成最终回答。
- 策略检查：屏蔽工具不会进入供应商工具列表，模型返回的服务或工具标识不会被信任；风险由 MCP 注解、服务端覆盖和 Agent 审批策略共同确定，模型无法自行降低风险或切换服务。
- 审批检查：只读工具可按策略自动执行，风险工具支持仅本次允许、本会话允许和拒绝；拒绝结果会返回模型继续回答，取消、用户切换和运行时销毁会解除所有等待并中止活动调用。
- 上限检查：单次运行最多执行 8 个工具调用，达到上限后后续模型请求显式禁用工具；畸形参数、未知工具、超时和工具错误均安全失败且不会产生第二个运行终态。
- 结果检查：超大文本按模型上下文和界面显示分别限长，图片、音频和资源仅保留安全元数据供 AT-18、AT-19 使用；配置凭据、认证头和常见令牌在 MCP 管理器边界脱敏后才进入运行器。
- UI 检查：对话时间线支持工具状态卡、参数与结果展开，以及带风险、服务和参数摘要的审批对话框；生命周期事件按 32ms 批量合并，不为每个增量触发独立渲染。
- 页面检查：应用内浏览器在默认桌面视口和 640×800 窄屏下完成“工具箱 → AI 对话”交互，页面身份、非空内容、无框架错误层和控制台健康均通过；原番茄钟入口与 AI 入口并存，无布局遮挡。
- 影响检查：Renderer 只新增受限审批 IPC，没有任意 MCP 执行接口；任务、笔记、书库、视频、保险箱和原有工具箱数据路径未修改。
- 遗留风险：真实图片、音频和资源内容当前仅保存安全摘要，受控本地资源 URL、Range 请求和媒体持久化由 AT-18 接入。

### AT-18 AI 媒体存储与安全资源协议

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiMediaSecurity.test.mjs` 6 项、`tests/aiMediaProtocol.test.mjs` 3 项和 `tests/indexSecurity.test.mjs` 4 项全部通过。
- 全量回归：`npm test`，339 项主测试及包含新增媒体安全、媒体协议、AI/MCP/会话、事务、保险箱和视频数据库在内的全部专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 依赖检查：`npm audit --audit-level=high` 返回 0 个漏洞，`git diff --check` 通过。
- 存储检查：Base64 和 HTTPS 响应先写入当前用户 `files/ai-media/.tmp`，通过大小、磁盘空间、真实文件签名、媒体类型和图片尺寸校验后，才按类型与年月目录原子重命名；数据库保存相对路径、MIME、字节数、尺寸和 SHA-256。
- 网络检查：远程媒体仅接受无内嵌凭据的 HTTPS；localhost、回环、链路本地、内网、保留地址和受控 IPv6 范围均拒绝，DNS 结果与每次重定向目标都会重新校验。
- 凭据检查：跨源重定向不会转发原始认证头；数据库与公开资产摘要只保存去除用户信息、查询和片段后的来源 URL。
- 中止检查：下载支持外部 AbortSignal 和受限超时；取消、超限、错误 MIME、磁盘或网络失败会清理临时文件并将资产记录置为失败，不会留下半成品完成记录。
- 文件检查：文件名仅作为清理后的元数据，实际文件名由应用生成；删除只接受数据库登记的相对路径，并通过 realpath 阻止路径穿越和符号链接逃逸。
- 协议检查：新增 `life-ai-asset://asset/{id}` 安全协议，只解析当前用户数据库中已完成的资产 ID；GET、HEAD、单段 Range、206 和 416 行为通过，响应带 `nosniff`、私有缓存和字节范围头。
- CSP 检查：图片与音视频仅新增 `life-ai-asset:` 受控协议来源，没有放开任意远程图片或媒体域名。
- 影响检查：现有 `life-video:` 协议、PDF blob、工具箱和其他数据库路径保持不变；媒体服务尚未暴露给 Renderer，也未直接接入具体供应商。
- 遗留风险：图片供应商请求与同步/异步结果提取、消息图片块和查看交互由 AT-19 接入；视频格式探测、转码与封面由 AT-20、AT-21 接入。

### AT-19 图片生成适配与对话展示

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiImageGeneration.test.ts`、`tests/aiToolLoop.test.ts`、`tests/aiIpcContract.test.ts` 与 `tests/aiChatUtils.test.ts` 共 27 项通过。
- 全量回归：`npm test`，345 项主测试及包含媒体安全、媒体协议、MCP、会话、事务、保险箱和视频数据库在内的全部专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 依赖检查：`npm audit --audit-level=high` 返回 0 个漏洞，`git diff --check` 通过。
- 适配检查：图片适配器统一解析 OpenAI/xAI 风格的 `b64_json`、Base64、远程 URL 和异步任务 ID；异步任务仅允许同源状态地址，支持轮询上限、超时、取消、认证失败和限流错误。
- 存储检查：供应商临时 URL 和 Base64 不进入消息内容；结果必须先经过 AT-18 媒体服务落盘，消息只保存资产 ID、受控 MIME、名称和替代文本，临时 URL 失效或应用重启后仍通过本地协议读取。
- MCP 检查：MCP `image` 内容块和带图片 MIME 的资源链接会经过同一媒体服务，工具消息只附加已完成的本地图片资产，首个资产同时关联到工具调用记录。
- 会话检查：图片生成创建用户消息、媒体任务、运行记录和最终图片块；错误内容只写入一个失败终态，用户切换会中止当前图片请求并清理下载。
- 并发检查：同一会话不能同时启动文本运行和图片生成，也不能重复启动图片生成；Renderer 仅暴露受限生成、另存和定位动作，没有文件路径读取接口。
- UI 检查：输入区增加仅在 Agent 配置图片供应商后可用的图片模式；单图和最多四图使用紧凑网格，点击可查看原图，并支持另存和在文件管理器中定位。
- 页面检查：应用内浏览器完成“工具箱 → AI 对话”冒烟交互，页面身份、非空内容、错误层和控制台健康通过；空配置引导态和原番茄钟入口不受图片功能影响。
- 影响检查：图片通过 `life-ai-asset:` 展示，不开放任意远程图片 CSP；文本、工具调用、现有 `life-video:` 和其他模块路径保持不变。
- 遗留风险：当前自动化使用兼容协议 mock 覆盖三种返回形式，真实 Grok/xAI 账户端到端将在 AT-25 使用用户提供的有效配置验收；视频任务和播放由 AT-20、AT-21 接入。

### AT-20 视频任务状态机与供应商适配

状态：已完成

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

建议提交：`feat: run AI video generation tasks`

完成记录：

- 针对性测试：`tests/aiVideoGeneration.test.mjs`，4 项通过。
- 全量回归：`npm test`，345 项主测试及包含媒体安全、媒体协议、MCP、会话、事务、保险箱和视频数据库在内的全部专项测试通过。
- 静态检查：`npm run lint` 通过。
- 构建检查：`npm run build` 通过。
- 依赖检查：`npm audit --audit-level=high` 返回 0 个漏洞，`git diff --check` 通过。
- 适配检查：视频适配器统一创建、查询和取消任务，兼容常见的 `task_id`/`id`、`status`/`state`、`url`/`video_url`/`output.url` 返回结构。
- 安全检查：状态查询 URL 必须与创建接口同源且不包含凭据；供应商原始签名 URL 不持久化，只在内存中交给 AT-21 下载处理。
- 状态检查：任务 ID 创建后立即保存，支持 queued、generating、polling、downloading、failed、cancelled 等可恢复状态，并记录轮询进度、失败、取消、超时和限流错误。
- 中止检查：每个任务使用独立取消控制，显式取消会尽力调用供应商取消接口并写入单一取消终态。
- 影响检查：本任务未接入 Renderer 播放器，也未改变既有 `life-video:`、视频库和图片展示路径；AT-21 将负责下载、格式探测、转码、封面和对话内播放。
- 遗留风险：真实 Grok/xAI 账户端到端将在 AT-25 使用用户提供的有效配置验收；当前视频结果 URL 仍需 AT-21 转为本地可播放资产。

### AT-21 视频下载、转码、封面与对话播放

状态：已完成

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

完成记录：

- 针对性测试：`tests/aiVideoAssetService.test.mjs` 6 项、`tests/aiConversationService.test.mjs` 11 项，以及 AI IPC、工具箱 locale/渲染契约测试 13 项通过。
- 全量回归：`npm test` 通过，347 项主测试及 AI schema、供应商、Agent、MCP、媒体安全、媒体协议、视频任务、视频资产、会话、事务、保险箱和视频数据库专项测试全部通过。
- 静态与构建检查：`npm run lint`、`npm run build`、`npm audit --audit-level=high` 和 `git diff --check` 全部通过；依赖审计为 0 个漏洞。
- 下载检查：供应商结果继续使用 HTTPS、DNS/SSRF、重定向、大小、磁盘空间和 MIME 校验；下载写回 AT-20 的原任务资产 ID，完成资产禁止再次覆盖，临时文件和签名 URL 不进入 Renderer。
- 转码检查：MP4/WebM 直接作为可播放资产；QuickTime 等不兼容容器保留已验证原始资产，并通过现有 FFmpeg 生成独立 MP4 播放副本。转码支持超时和取消，FFmpeg 缺失、失败或输出无效时写入单一失败终态，不把原始文件伪装成可播放结果。
- 封面与时长检查：使用现有视频工具探测时长；FFmpeg 最佳努力生成 JPEG 封面，封面失败不阻断已兼容视频播放。视频、封面和时长元数据可从消息数据库完整恢复。
- 对话检查：视频模式只依赖视频生成 IPC，发送后立即显示本地生成中状态；完成后使用 `life-ai-asset:` 受控 URL 在消息内播放，支持 metadata 预载、封面、浏览器原生控制、另存为和文件定位。
- 协议与安全检查：既有 AI 媒体协议的 GET、HEAD、Range、206 和 416 测试继续通过；消息、preload 和 IPC 不暴露供应商原始 URL、API Key、任意本地路径或通用下载接口。
- 页面检查：应用内浏览器完成“仪表盘 → 小工具箱 → AI 对话”复测，页面身份、非空白、无框架错误层、控制台健康、交互与截图证据均通过。
- 影响检查：全量回归通过，未改变既有 `life-video:` 视频库播放与下载路径，也未影响任务、笔记、书库、保险箱和原有工具箱入口。
- 遗留风险：真实 Grok/xAI 视频账户端到端仍需 AT-25 使用用户有效凭据验收；转码后保留的原始源资产及长期容量清理由 AT-22 统一管理。

### AT-22 任务恢复、容量清理与备份边界

状态：已完成

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

完成记录：

- 恢复检查：AI schema 升级至 v2 并保存视频任务的 run/message 关联；启动时仅中断普通未完成运行，可查询的视频任务按供应商任务 ID 继续轮询，本地已下载但尚未完成后处理的视频直接续作，不重复查询或下载。
- 暂停检查：退出、切换用户和创建备份只暂停后台恢复，不把任务误记为用户取消；下次会话仍保留原消息、run 和媒体状态。不可恢复的活动媒体统一标记为 interrupted，避免伪完成。
- 存储检查：新增数据库、媒体、孤儿和临时文件占用统计，并按图片、视频、音频和文件分类；支持未引用、媒体类型、会话、容量、全部媒体和全部 AI 数据清理，活动任务会阻止危险清理。
- 一致性检查：清理前生成包含资源状态与实际文件大小的确认哈希，数据变化后旧计划失效；登记媒体先移入 `.trash`，数据库删除失败时恢复原文件；容量自动策略只删除未引用终态媒体。
- 备份检查：普通备份 manifest 明确记录 AI 数据库、媒体文件和 schema 版本，`ai-credentials.json` 永不进入普通备份；检查和恢复均拒绝被注入的 AI 凭据文件，备份完成或失败后重新启动恢复。
- UI 检查：AI 导航新增“媒体与存储”，展示容量概览、类型统计、恢复任务、容量策略、清理范围、影响轮播与二次确认；GSAP 动效提供 reduced-motion 降级，桌面和最小 800px 窗口均无水平溢出。
- 针对性测试：schema 迁移、任务恢复、视频续作、存储清理、备份边界、IPC、locale 与布局契约测试全部通过，覆盖恢复暂停、本地后处理续作、陈旧清理计划和删除回滚。
- 全量门禁：`npm test`、`npm run lint`、`npm run build`、`npm audit --audit-level=high` 与 `git diff --check` 全部通过；依赖审计为 0 个漏洞。
- 影响检查：既有文本、图片、视频、MCP、会话、任务、笔记、书库、保险箱和视频库回归通过；真实供应商长任务跨进程端到端仍由 AT-25 使用有效账户配置验收。

### AT-23 首次引导、响应式与 GSAP 动效

状态：已完成

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

完成记录：

- 首次体验：无供应商时展示独立引导页，完成首个供应商保存后自动返回日常对话工作区；已有供应商的用户直接进入工作区，不重复显示引导。
- 结构检查：沿用 AI 顶部导航并完成 AIDA 页面结构；Cinematic Center 展示标题保持 2–3 行，包含双 CTA 与 Inline Typography Image，不使用统计、印章或廉价元标签。
- Bento 检查：桌面 6×2 网格使用五张卡完整覆盖 12 个单元，面积为 `3×2 + 3×1 + 1×1 + 1×1 + 1×1 = 12` 且启用 dense flow；960 与 800 档分别闭合为 4 列和 2 列布局。
- 组件检查：首次引导包含 Horizontal Accordions、Infinite Marquee、供应商/Agent/MCP 快捷入口、固定说明与卡片堆叠；按钮、卡片和图片区域均有明确对比和 hover 反馈。
- 动效检查：使用 `@gsap/react` 与 ScrollTrigger 实现 Hero 入场、Scroll Pinning 和 Card Stacking；动效只挂载在首次引导组件，reduced-motion 会在注册非必要 ScrollTrigger 前退出，并关闭 marquee 与长过渡。
- 响应式检查：AI 工作区高度随窗口约束在 520–860px，引导使用独立垂直滚动容器；应用内浏览器验证 1280、960、800 三档均无页面或内部横向溢出，标题为 2–3 行，实际滚动可触发堆叠矩阵变化。
- 针对性测试：新增 onboarding 布局与 motion 回归测试，连同 locale 和工具箱契约测试全部通过；覆盖 12 单元密度、标题宽度、三档断点、自动退出和 reduced-motion 顺序。
- 全量门禁：`npm test`、`npm run lint`、`npm run build`、`npm audit --audit-level=high` 与 `git diff --check` 全部通过；依赖审计为 0 个漏洞。
- 影响检查：日常 ChatWorkspace、模型供应商、Agent、MCP、媒体与存储页面不挂载首次引导重动效；工具箱番茄钟和其他主模块入口保持可用。

### AT-24 国际化、键盘与无障碍收口

状态：进行中

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
