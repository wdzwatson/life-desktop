# C-05 升级与失败恢复演练记录

日期：2026-07-17
任务：C-05
状态：阻塞，未完成真实升级演练
版本对：1.0.1 → 1.0.2

## 1. 已执行的检查

- 1.0.1 基线 DMG/ZIP 已生成并记录 SHA-256。
- 1.0.2 测试更新 DMG/ZIP 已生成并记录 SHA-256。
- 两个版本的构建、测试和静态检查均通过。
- 1.0.1/1.0.2 的 ZIP 均包含 `LifeOS.app`、`app.asar` 和原生模块 unpacked 目录。
- 1.0.1 基线打包应用可启动并监听 DevTools 端口。
- 1.0.2 测试打包流程成功完成。

## 2. 阻塞证据

启动打包应用时，生产更新路径向 GitHub provider 检查版本并返回：

> No published versions on GitHub

同时 electron-builder 输出：

> skipped macOS application code signing: cannot find valid Developer ID Application identity

因此当前无法在真实条件下完成：

- 旧版本发现 1.0.2 发布版本。
- 通过 `electron-updater` 下载更新。
- `quitAndInstall` 安装新版本并重启。
- 签名包的 Gatekeeper / 公证验证。
- 更新源、签名和安装权限失败后的真实回退。

## 3. 已完成的本地级验证

| 场景 | 结果 | 说明 |
|---|---|---|
| 源码构建 | 通过 | `npm run build` 通过 |
| 1.0.1 基线构建 | 通过 | 产物结构和 SHA-256 已归档 |
| 1.0.2 测试包构建 | 通过 | 产物结构和 SHA-256 已归档 |
| 单元/数据库/服务回归 | 通过 | 238 + 20 + 11 + 10 全部通过 |
| 更新配置读取 | 已确认 | provider 指向 `wdzwatson/life-desktop` |
| GitHub 版本发现 | 阻塞 | 当前无 published release |
| 签名与 Gatekeeper | 阻塞 | 无有效 Developer ID identity |
| 下载中断/磁盘不足/安装回退 | 未执行 | 依赖真实更新包和发布权限 |

## 4. 恢复演练准备

真实条件满足后，按以下顺序执行：

1. 安装并启动 1.0.1，创建任务、笔记、书籍记录和视频元数据。
2. 关闭应用并记录 `~/LifeOS` 数据清单与数据库校验值。
3. 发布 1.0.2 的签名包、latest metadata 和 blockmap。
4. 从 1.0.1 检查更新、下载、重启安装。
5. 验证用户数据、数据库 schema、密码库和视频配置保持不变。
6. 人为制造网络中断、磁盘空间不足或损坏下载，确认原版本和数据可继续使用。
7. 记录每个场景的日志、产物版本和结果。

## 5. 解除阻塞条件

- 发布负责人提供 GitHub Release 权限，并在 `wdzwatson/life-desktop` 发布可访问的 1.0.1/1.0.2 版本。
- 配置 Developer ID Application 证书和公证凭据，重新生成签名包。
- 取得可运行的干净 macOS 测试环境，完成安装、升级和失败恢复。

## 6. 证据索引

- C-01 更新配置：`docs/archive/release/2026-07-17-c01-production-update-config-audit.md`
- C-02 签名条件：`docs/archive/release/2026-07-17-c02-macos-signing-notarization-audit.md`
- C-03 基线包：`docs/archive/release/2026-07-17-c03-macos-baseline-artifact.md`
- C-04 测试更新包：`docs/archive/release/2026-07-17-c04-test-update-artifact.md`

## 7. 结论

C-05 当前不能标记为通过。源码和两版本产物已准备完毕，但真实升级链路依赖外部 GitHub 发布权限、签名和公证条件；在这些条件满足前，不对“自动更新可用”或“失败可回退”作发布承诺。
