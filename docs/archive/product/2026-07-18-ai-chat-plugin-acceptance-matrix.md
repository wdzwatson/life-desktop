# AI 对话插件需求—实现—验收矩阵

依据：[产品设计与功能需求规格](./2026-07-18-ai-chat-plugin-product-design-spec.md)

| 需求范围 | 实现证据 | 验收证据 | 结论 |
| --- | --- | --- | --- |
| FR-001–005 入口与初始化 | Toolbox 懒加载、AIChat、AIOnboarding、用户隔离数据库 | toolbox、onboarding、IPC 与浏览器测试 | 必须项通过；最后会话记忆为应该项，保留现状 |
| FR-101–111 供应商 | ProviderManager、ProviderService、CredentialService | provider service、validation、locale、IPC 测试 | 通过 |
| FR-201–207 Agent | AgentManager、AgentService、不可变快照 | agent service、utils、locale 测试 | 通过 |
| FR-301–309 MCP | McpManager、McpManager runtime、HTTP/SSE/stdio | MCP config/runtime、脱敏、取消与重连测试 | 通过 |
| FR-401–406 会话 | ConversationList、ConversationService、Markdown 导出 | conversation service/IPC、chat utils、round-trip | 通过 |
| FR-501–509 对话运行 | AgentRuntime、OpenAI-compatible adapter、恢复服务 | runtime、provider adapter、state、recovery 测试 | 通过 |
| FR-601–607 工具调用 | 工具循环、风险策略、Accessible 授权对话框 | tool loop/policy/approval、MCP manager 测试 | 必须项通过；会话临时禁用 MCP 为应该项，未单独提供 UI |
| FR-701–710 图片与视频 | 媒体服务、图片/视频适配、转码、播放器、受控协议 | media security/protocol、image/video generation 与 asset 测试 | 通过；真实供应商待凭据 |
| FR-801–805 存储与备份 | StorageManager、StorageService、RecoveryService、backup manifest | storage/recovery/backup/schema 测试 | 通过 |
| FR-901–906 国际化与无障碍 | 中英文 locale、焦点陷阱、原子 live region、媒体 alt、reduced motion | aiLocales、aiAccessibility、motion、800×600 浏览器验证 | 通过 |
| 跨模块与打包 | AI 模块隔离、既有全量测试、Electron builder | `npm test`、native 验证、macOS dir 包 | macOS 内部验收通过；Windows 实包、签名/公证待补 |

## 首版门槛

- 首版必须项均有实现与测试证据。
- 自动化未发现 P0/P1 安全、数据一致性或跨模块回归。
- 外部条件遗留已明确限定，不把 mock 验收表述为真实供应商或正式签名包验收。
