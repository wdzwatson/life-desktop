# LifeOS v1.0.2 发布前阻塞整改 Backlog

- 日期：2026-07-18
- 来源：E-03 RC 评审结论与 RC 收口交接索引
- 当前目标：把剩余阻塞项拆成可执行原子任务，供发布负责人、QA 和产品经理接手
- 当前结论：不扩大功能范围，优先解除发布工程与真实反馈阻塞

## 1. 执行原则

1. 不新增非必要功能。
2. 不把未签名包作为公开发布物。
3. 不把开发 mock 更新流程当作真实自动更新。
4. 不在仓库、日志或归档文档中写入 Apple、GitHub 或证书密钥。
5. 每个任务完成后必须归档证据并单独提交。

## 2. P0 阻塞任务

### R-01 配置 macOS Developer ID 签名条件

- 负责人：发布负责人
- 优先级：P0
- 前置条件：
  - Apple Developer Program 权限。
  - Developer ID Application 证书。
  - `com.wdzwatson.lifedesktop` Bundle ID 权限确认。
- 动作：
  1. 在本机或 CI keychain 中安装 Developer ID Application 证书。
  2. 确认 `security find-identity -v -p codesigning` 能看到有效身份。
  3. 不把证书、密码或 keychain profile 写入仓库。
- 验收：
  - `security find-identity -v -p codesigning` 返回至少 1 个有效 Developer ID Application identity。
  - 归档证据只记录 identity 摘要和命令结果，不记录私钥或密码。
- 归档建议：
  - `docs/archive/release/YYYY-MM-DD-r01-developer-id-signing-condition.md`

### R-02 添加最小 hardened runtime 与 entitlements 配置

- 负责人：Electron / 发布工程
- 优先级：P0
- 前置条件：
  - R-01 可用签名身份。
  - 确认 Electron、better-sqlite3、视频工具路径和 app protocol 运行需求。
- 动作：
  1. 新增 `build/entitlements.mac.plist`。
  2. 在 `package.json` 的 mac build 配置中启用 `hardenedRuntime`、`entitlements`、`entitlementsInherit`。
  3. 使用最小权限原则，不预先打开无依据权限。
  4. 运行构建与打包。
- 验收：
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - `npm run build:app`
  - `codesign --verify --deep --strict --verbose=2 dist_electron/mac/LifeOS.app`
  - 打包应用启动并完成 Dashboard、Settings、视频工具检测 smoke test。
- 归档建议：
  - `docs/archive/release/YYYY-MM-DD-r02-hardened-runtime-entitlements.md`

### R-03 完成 macOS 公证与 Gatekeeper 验证

- 负责人：发布负责人
- 优先级：P0
- 前置条件：
  - R-01、R-02 完成。
  - Apple notarization 凭据可安全注入。
- 动作：
  1. 使用 notarytool 提交 DMG / ZIP 或 app 产物。
  2. 等待公证完成。
  3. 执行 stapler。
  4. 在干净 macOS 环境执行 Gatekeeper 验证。
- 验收：
  - `xcrun notarytool submit ... --wait` 成功。
  - `xcrun stapler validate dist_electron/LifeOS-1.0.2.dmg` 成功。
  - `spctl --assess --type open --context context:primary-signature -v dist_electron/LifeOS-1.0.2.dmg` 成功。
  - 干净机器可打开安装包，不出现“损坏”或未验证开发者阻塞。
- 归档建议：
  - `docs/archive/release/YYYY-MM-DD-r03-notarization-gatekeeper-validation.md`

### R-04 准备 GitHub Published Release 与更新 metadata

- 负责人：发布负责人
- 优先级：P0
- 前置条件：
  - GitHub `wdzwatson/life-desktop` Release 权限。
  - R-03 签名/公证包。
- 动作：
  1. 发布可访问的 1.0.1 基线版本。
  2. 发布可访问的 1.0.2 测试更新版本。
  3. 确认 electron-builder 生成的 latest metadata、blockmap 和安装包均上传。
  4. 确认 release 标记是否为 draft / prerelease，并与测试策略一致。
- 验收：
  - 旧版本应用调用 `autoUpdater.checkForUpdates()` 能发现 1.0.2。
  - GitHub release 页面可访问对应资产。
  - metadata 指向签名/公证后的最终包。
- 归档建议：
  - `docs/archive/release/YYYY-MM-DD-r04-github-release-update-metadata.md`

### R-05 执行真实自动更新与失败恢复演练

- 负责人：QA + 发布负责人
- 优先级：P0
- 前置条件：
  - R-01 至 R-04 完成。
  - 干净 macOS 测试环境。
- 动作：
  1. 安装并启动 1.0.1。
  2. 创建任务、笔记、书籍、视频元数据和设置项。
  3. 记录 `/Users/mac/LifeOS` 数据清单与关键数据库 checksum。
  4. 检查更新并升级到 1.0.2。
  5. 验证数据保留、schema、密码库、视频配置。
  6. 模拟下载中断、损坏包或权限失败，确认原版本与数据可继续使用。
- 验收：
  - 1.0.1 能发现 1.0.2。
  - 下载、安装、重启闭环成功。
  - 用户数据未丢失。
  - 失败场景有可读反馈，且不会破坏原数据。
- 归档建议：
  - `docs/archive/release/YYYY-MM-DD-r05-real-upgrade-recovery-drill.md`

## 3. P1 试用与 QA 补测任务

### R-06 收集内部真实试用反馈

- 负责人：产品经理 + QA
- 优先级：P1
- 前置条件：
  - 试用人员 2-3 名。
  - 试用前数据备份。
  - 试用包与 E-01 / E-02 文档已发送。
- 动作：
  1. 按 E-02 试用脚本执行。
  2. 收集反馈、截图和日志。
  3. 按 P0 / P1 / P2 / 建议分类。
  4. 为每条反馈给出处理决定。
- 验收：
  - 所有反馈均有严重等级和处理决定。
  - P0 必须修复或阻断发布。
  - P1 必须修复或获得明确延期批准。
- 归档建议：
  - `docs/archive/release/YYYY-MM-DD-r06-internal-trial-feedback-results.md`

### R-07 补测视频真实下载成功与 Cookie 授权

- 负责人：视频模块开发 + QA
- 优先级：P1
- 前置条件：
  - 安装可用 `yt-dlp`。
  - 安装可用 `ffmpeg`。
  - 准备公开可访问 URL 和需要 Cookie / 会员权限的测试 URL。
- 动作：
  1. 检查视频工具状态。
  2. 解析公开源。
  3. 下载公开源并本地播放。
  4. 验证 Cookie 授权。
  5. 验证失败、重试和日志反馈。
- 验收：
  - 至少 1 个公开源真实下载成功。
  - 至少 1 个 Cookie 授权或授权失败场景有清晰反馈。
  - 下载完成后本地播放路径安全。
- 归档建议：
  - `docs/archive/qa/YYYY-MM-DD-r07-real-video-download-cookie-validation.md`

### R-08 补测真实磁盘满 ENOSPC

- 负责人：QA
- 优先级：P1
- 前置条件：
  - 独立 APFS 沙箱卷或 CI 临时卷。
  - 不在真实系统盘制造满盘风险。
- 动作：
  1. 在沙箱卷创建受限空间。
  2. 将 LifeOS 数据目录或备份目标指向该卷。
  3. 执行备份、导入大文件或视频下载。
  4. 触发 ENOSPC。
  5. 验证错误反馈与原数据完整性。
- 验收：
  - 应用返回可理解错误。
  - 原数据库、原文件和备份源不被破坏。
  - 不产生误报成功。
- 归档建议：
  - `docs/archive/qa/YYYY-MM-DD-r08-enospc-data-safety-validation.md`

## 4. 再评审入口

当 R-01 至 R-06 至少完成后，重新召开 RC 评审。

再评审应更新：

- `docs/archive/release/YYYY-MM-DD-e03-rc-review-decision-followup.md`

再评审结论仍使用三选一：

- 发布。
- 延期。
- 回退整改。

## 5. 当前不可继续自动推进的原因

以下任务需要外部权限、真实环境或用户输入，当前不能由本地代码代理继续完成：

- Developer ID 证书和 Apple 公证凭据。
- GitHub Release 发布权限。
- 干净 macOS 真实升级环境。
- 内部试用人员真实反馈。
- 视频平台登录态和 Cookie 授权。
- 独立沙箱卷真实 ENOSPC 环境。
