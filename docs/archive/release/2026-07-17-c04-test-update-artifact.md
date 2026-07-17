# C-04 v1.0.2 测试更新包

日期：2026-07-17
任务：C-04
状态：已完成测试包构建，真实更新演练待 C-05
基线版本：1.0.1
测试更新版本：1.0.2
平台：macOS x64

## 1. 版本变更

- `package.json` 版本从 `1.0.1` 递增为 `1.0.2`。
- `package-lock.json` 根包版本同步为 `1.0.2`。
- 依赖版本未改变，数据库 schema 和用户数据格式未改变。
- 该版本用于内部升级演练，不代表正式发布版本。

## 2. 产物与校验值

| 产物 | 大小 | SHA-256 |
|---|---:|---|
| `dist_electron/LifeOS-1.0.2.dmg` | 154 MB | `957fe4e267aca826acd290506f67caf96f6cf0e6b54d372e7679b4ecac44303f` |
| `dist_electron/LifeOS-1.0.2-mac.zip` | 153 MB | `d0e3f456fe158a8300674deac4fbf25cadb68084b37a6d6c840209984e07076a` |

ZIP 中包含 `LifeOS.app/Contents/Resources/app.asar` 和 unpacked 原生模块目录，产物结构与 1.0.1 基线一致。

## 3. 构建与验证

- `npm run build:app`：成功。
- `npm test`：238 + 20 + 11 + 10 项全部通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- electron-builder：26.15.3。
- Electron：42.6.1。
- Node：满足 `>=24.18.0 <25`。

## 4. 已知限制

- 本机没有有效 Developer ID Application identity，产物仍未签名。
- GitHub provider 目前没有已发布版本，无法在本机执行真实 `electron-updater` 下载。
- 不能将本包当作正式分发包；C-05 必须在签名和发布权限满足后，或明确记录“未签名内部演练”边界。

## 5. C-05 输入

C-05 使用以下版本对进行升级演练：

- 旧版本：`LifeOS-1.0.1.dmg` / `LifeOS-1.0.1-mac.zip`
- 新版本：`LifeOS-1.0.2.dmg` / `LifeOS-1.0.2-mac.zip`

演练至少覆盖：用户数据保留、数据库兼容、正常升级、更新源不可用、下载中断、磁盘不足和失败回退。

## 6. 证据索引

- 版本基线审计：`docs/archive/release/2026-07-17-c03-macos-baseline-artifact.md`
- 签名条件审计：`docs/archive/release/2026-07-17-c02-macos-signing-notarization-audit.md`
- 更新配置审计：`docs/archive/release/2026-07-17-c01-production-update-config-audit.md`
- 版本文件：`package.json`、`package-lock.json`

## 7. 结论

C-04 已完成第二个 macOS 测试更新包的生成、校验和版本同步。版本对的构建输入已经准备好；真实升级能否通过仍取决于 GitHub 发布版本、签名、公证和 C-05 演练条件。
