# C-03 macOS v1.0.1 基线安装包

日期：2026-07-17
任务：C-03
状态：已完成基线构建，签名与发布仍阻塞
版本：1.0.1
平台：macOS x64

## 1. 构建结果

执行：`npm run build:app`

构建过程包括：

- TypeScript、Vite、Electron 主进程和 preload 构建通过。
- `better-sqlite3` 原生模块按 Electron 42.6.1 / x64 重新匹配。
- electron-builder 26.15.3 读取 `package.json` 的 macOS dmg/zip 配置。
- 生成 DMG、ZIP 和对应 blockmap。

## 2. 产物与校验值

| 产物 | 大小 | SHA-256 |
|---|---:|---|
| `dist_electron/LifeOS-1.0.1.dmg` | 154 MB | `e66c7df84c29524c4fb8cb333bd1c443606306e8b42143eae6a5e889f8a0adfd` |
| `dist_electron/LifeOS-1.0.1-mac.zip` | 153 MB | `313ef96c69d80216c47226e918de6ef2a7958a1f0277e36491078021305e2523` |
| `dist_electron/LifeOS-1.0.1.dmg.blockmap` | 164 KB | 未作为安装包发布 |
| `dist_electron/LifeOS-1.0.1-mac.zip.blockmap` | 161 KB | 未作为安装包发布 |

## 3. 结构检查

- ZIP 可读取，包含 `LifeOS.app/Contents/Resources/app.asar`。
- DMG 可由 `hdiutil imageinfo` 识别为 UDZO / GUID 只读镜像。
- 打包应用主程序直接启动成功，并监听 DevTools 端口 `9224`。
- 启动冒烟期间未出现主进程崩溃。

## 4. 已知阻塞

electron-builder 输出：

> skipped macOS application code signing: cannot find valid Developer ID Application identity

因此当前产物：

- 未签名，不能作为公开发布包。
- 未完成公证，Gatekeeper 验收未通过。
- 不应拿作正式自动更新源。

打包应用启动时还尝试访问 GitHub 更新源，并返回：

> No published versions on GitHub

这与 C-01 结论一致：仓库配置已存在，但远端还没有可供 `electron-updater` 读取的正式发布版本。

## 5. 后续用途

- C-04：以本包作为升级演练的旧版本基线，生成第二个测试版本。
- C-05：在签名条件满足后执行真实升级、网络中断、磁盘空间不足和数据保留演练。
- C-02：获得证书和公证条件后，重新构建同版本或递增版本并复算 SHA-256。

## 6. 证据索引

- 构建配置：`package.json`
- 签名条件审计：`docs/archive/release/2026-07-17-c02-macos-signing-notarization-audit.md`
- 更新配置审计：`docs/archive/release/2026-07-17-c01-production-update-config-audit.md`
- 构建命令：`npm run build:app`
- 结构检查：`file`、`unzip -l`、`hdiutil imageinfo`

## 7. 结论

C-03 已完成 macOS x64 基线安装包的生成、结构核验、校验值记录和启动冒烟。产物质量可用于内部升级研发，但由于缺少有效签名、公证和 GitHub 发布版本，不能进入正式分发或自动更新渠道。
