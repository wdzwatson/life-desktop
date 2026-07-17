# C-01 生产更新配置检查

日期：2026-07-17
任务：C-01
状态：已完成（配置盘点完成，生产演练仍阻塞）
检查对象：`package.json`、`electron/main.ts`、Git remote、`.github/`

## 1. 配置核对结果

| 检查项 | 当前结果 | 判断 |
|---|---|---|
| GitHub 仓库 | `https://github.com/wdzwatson/life-desktop.git` | 已确认，与构建发布配置的 owner/repo 一致 |
| electron-builder provider | `github` | 已配置，owner=`wdzwatson`、repo=`life-desktop` |
| 当前版本 | `1.0.1` | 已存在版本号；不能据此证明已有可升级的上一版安装包 |
| 更新库 | `electron-updater` `^6.8.9` | 生产分支调用 `checkForUpdates` / `downloadUpdate` / `quitAndInstall` |
| 开发环境边界 | `!app.isPackaged` 或 Vite dev URL 时走 mock | 已有明确代码分支；设置页已显示开发模拟提示 |
| macOS 目标 | `dmg`、`zip` | 已配置，优先 RC 主平台 |
| Windows 目标 | `nsis`、`zip` | 已配置，但尚未完成 Windows 验收 |
| Linux 目标 | 未配置 | 不纳入当前 RC 发布门禁 |
| 自动下载 | `autoUpdater.autoDownload = false` | 用户手动检查并下载，策略明确 |
| 自动安装 | `autoUpdater.autoInstallOnAppQuit = true` | 下载后退出时自动安装，需真实升级演练确认行为 |
| CI / release workflow | 当前 `.github/` 未发现可用 workflow 文件 | 发布门禁缺失，列为 P1/P0 发布准备风险 |
| 签名、公证、发布权限 | 仓库配置中无证据 | C-02 必须补充，不得宣称可公开发布 |

## 2. 开发 / 生产行为边界

开发环境：

- 检查更新固定返回模拟版本 `1.1.0`。
- 下载过程使用随机进度模拟，不下载真实包。
- 安装操作只返回模拟成功，不重启应用。

生产环境：

- 由 `electron-updater` 读取 GitHub provider 配置。
- 检查、下载和安装失败通过 `update:error` 反馈到设置页。
- 下载完成后由 `quitAndInstall` 执行安装。

这两条路径已经在代码中分开，但生产路径尚未通过真实发布源、签名和双版本升级验证。

## 3. C-01 验收结论

- [x] GitHub owner / repo 已确认。
- [x] 当前版本号已确认。
- [x] macOS / Windows 构建目标已确认。
- [x] electron-updater 生产调用路径已确认。
- [x] 开发 mock 与生产分支已区分，并在 UI 提示开发模拟。
- [ ] 发布权限已确认。需要发布负责人提供 GitHub release 权限或 token 管理方式。
- [ ] 代码签名、公证和 Windows 签名条件已确认，转入 C-02。
- [ ] 两个真实版本升级演练已完成，转入 C-04/C-05。
- [ ] CI / release workflow 已建立，转入 C-06。

## 4. 发布阻塞项

当前不能把 `npm run build:app` 的成功等同于“可自动更新发布”。仍需：

1. C-02：确认 macOS 证书、entitlements、公证账号和密钥保管方式。
2. C-03：生成并校验基线安装包，记录产物 SHA-256。
3. C-04：生成第二个测试更新包和 release 元数据。
4. C-05：覆盖正常升级、网络中断、空间不足、升级失败和数据保留。
5. C-06：增加 test/build/lint 与构建产物检查的 CI 门禁。

## 5. 证据索引

- 构建和发布配置：`package.json`
- 生产/开发更新分支：`electron/main.ts`
- 设置更新入口：`src/views/Settings.tsx`
- 开发模拟提示：`src/locales/zh-CN.json`、`src/locales/en-US.json`
- 本次验证：`npm test`、`npm run build`、`npm run lint` 均通过；Electron 启动冒烟通过。

## 6. 结论

C-01 已完成配置盘点，但发布准备状态仍为“配置存在、真实发布未验证”。GitHub provider、版本和平台目标已对齐；签名、公证、权限、CI 和双版本升级演练继续作为发布阻塞项，不因配置文件存在而提前放行。
