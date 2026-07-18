# S-02 跨平台原生模块重建与格式门禁

- 日期：2026-07-18
- 状态：已完成
- 影响范围：依赖安装、`better-sqlite3`、macOS / Windows / Linux 打包

## 1. 问题

macOS 交叉生成 Windows 包时，Electron 和 NSIS 外壳能够成功生成，但包内 `better_sqlite3.node` 仍可能是 macOS Mach-O 文件。仅依据 electron-builder 退出码会产生“打包成功但 Windows 启动数据库失败”的假阳性。

原有 `postinstall` 还直接调用 `@electron/rebuild` 并强制源码构建，增加了 Windows 环境对本地 C++ 工具链的要求，同时 electron-builder 已内置对应的依赖重建流程。

## 2. 修改

- 将原生模块重建入口调整为 `electron-builder install-app-deps`。
- 移除项目直接依赖的 `@electron/rebuild` 和旧的 `scripts/rebuild-native.mjs`。
- 新增 `npm run verify:native`。
- 在 `postinstall` 和 `build:app` 中加入原生模块格式门禁。
- 新增 `scripts/verify-native-module.mjs`：
  - 识别 macOS Mach-O、Windows PE 和 Linux ELF。
  - 识别 x64、ia32、arm64 和 armv7l。
  - 同时校验目标平台与目标架构。
- 新增 3 项自动化测试，覆盖正确识别、匹配通过和跨平台错误拒绝。

## 3. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 通过，postinstall 自动重建并验证 Mach-O/x64 |
| `npm run verify:native` | 通过 |
| 错误 Windows 交叉包检查 | 正确拒绝 Mach-O/x64，预期为 PE/x64 |
| 原生格式专项测试 | 3 / 3 通过 |
| 全量测试 | 241 + 20 + 11 + 10 全部通过 |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，DMG / ZIP / blockmap 生成成功 |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| Prettier 检查 | 通过 |
| `git diff --check` | 通过 |

## 4. 回归影响

- macOS x64 当前原生模块被正确识别为 Mach-O/x64。
- 依赖安装仍会按 Electron 42.6.1 重建 `better-sqlite3`。
- 数据库、保险箱、备份恢复、任务、笔记、书籍和视频全量测试均通过。
- 完整 macOS 打包未受到影响。

## 5. 已知外部条件

- Windows PE/x64 的真实正向验证需要在 Windows 原生 runner 执行，转入 Windows CI 原子任务。
- macOS 打包仍因缺少有效 Developer ID Application identity 跳过签名，属于既有 R-01 阻塞。

## 6. 结论

依赖安装和打包流程现已具备原生模块平台/架构门禁，能够阻止错误平台二进制被误判为有效产物，并为下一步 Windows CI 原生打包验证提供可复用检查工具。
