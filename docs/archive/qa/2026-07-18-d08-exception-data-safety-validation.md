# D-08 异常与数据安全场景验收记录

- 日期：2026-07-18
- 任务：D-08 验收异常和数据安全场景
- 范围：断网、无视频工具、文件损坏、无权限/不可写目录、磁盘不足代理、恢复失败、更新失败
- 结论：通过，带 1 项发布前复核建议。已修复更新失败 UI 中的 English fallback 硬编码中文问题。

## 数据保护

- D-08 打包应用验收前关闭 LifeOS。
- 将真实数据目录 `/Users/mac/LifeOS` 临时移动到 `/Users/mac/LifeOS.codex-d08-backup-20260718-001`。
- 使用空 `/Users/mac/LifeOS` 执行打包应用异常验证。
- 验收后测试数据已移动到 `/tmp/LifeOS.codex-d08-evidence-20260718-001`。
- 真实数据已恢复回 `/Users/mac/LifeOS`。

## 验收包

- 应用：`dist_electron/mac/LifeOS.app`
- DMG：`dist_electron/LifeOS-1.0.2.dmg`
  - SHA256：`67da4a16b9d6d0caff5d372aa92c92fd305409f6d17ec294e38811233368aa95`
- ZIP：`dist_electron/LifeOS-1.0.2-mac.zip`
  - SHA256：`13f2614372b2bddf1e738743457d156a3b5becf09c7a5b76cae2ed45996e4d0e`

## 发现与修复

| 问题 | 处理 | 结果 |
| --- | --- | --- |
| Settings 更新失败区域在 English UI 中仍显示“手动前往 GitHub 下载 / 手动下载包”。 | 新增 `settings.updates_manual_download` 中英文文案，并替换硬编码按钮文本。 | 通过，打包应用更新失败状态显示 `Download manually from GitHub`，未出现硬编码中文。 |

## 自动与服务层验收摘要

### 备份、恢复与文件安全

证据目录：`/tmp/lifeos-d08-service-evidence-20260718-001`

- JSON 报告：`d08-service-validation-report.json`
- 样例包：
  - `exports/lifeos-backup-guest-2026-07-18T02-00-00-000Z.zip`
  - `corrupt-checksum.zip`
  - `unsafe-path.zip`

| 场景 | 结果 |
| --- | --- |
| 创建 manifest 备份 | 通过；备份文件可 inspect，文件数 3。 |
| 敏感 vault legacy backup 排除 | 通过；包内无 `vault-sensitive-backups`。 |
| 外部视频目录不复制 | 通过；只记录 external video directory，不复制外部视频文件。 |
| 正常恢复并保留敏感恢复备份 | 通过；恢复文件数 3，旧敏感恢复文件保留。 |
| 损坏备份 checksum | 通过；拒绝恢复，错误为 `Backup checksum mismatch: config/settings.json`，现有数据未被破坏。 |
| 非安全路径逃逸 | 通过；拒绝 inspect，错误为 `Unsafe backup path: ../escape.db`。 |
| 不可写/非法目标路径 | 通过；备份创建失败并返回 `ENOTDIR`，未产生半成品成功状态。 |
| 缺失备份文件 | 通过；返回 `Backup file not found.`。 |

### 打包应用异常反馈

证据目录：`/tmp/lifeos-d08-app-evidence-20260718-001`

- 更新失败报告：`d08-update-validation-report.json`
- 视频工具报告：`d08-video-tools-validation-report.json`
- 更新失败截图：`d08-settings-update-failure.png`

| 场景 | 结果 |
| --- | --- |
| 更新流程失败反馈 | 通过；直接触发下载前置条件失败，UI 显示 `Failed to check for updates: Please check update first` 和 `Download manually from GitHub`。 |
| English 更新失败文案 | 通过；未出现“手动前往 GitHub 下载 / 手动下载包”。 |
| 无 yt-dlp | 通过；返回 `spawn yt-dlp ENOENT`，应用不崩溃。 |
| 无 ffmpeg | 通过；返回 `spawn ffmpeg ENOENT`，应用不崩溃。 |
| 离线基础状态 | 通过；本地 file:// 打包应用可进入 Dashboard / Settings，状态栏显示 Offline Mode；核心本地界面不依赖外部网络。 |

## 验证命令

```bash
npm test
npm run build
npm run lint
npm run build:app
shasum -a 256 dist_electron/LifeOS-1.0.2.dmg dist_electron/LifeOS-1.0.2-mac.zip
```

补充验证：

- 通过 `npx tsx` 执行备份/恢复服务层异常脚本。
- 通过 Electron 远程调试端口调用 `window.electronAPI.downloadUpdate()` 与 `window.electronAPI.checkVideoTools()` 验证打包应用反馈。

## 风险与发布前复核建议

- 磁盘不足没有在真实系统盘上制造满盘场景，以避免影响工作站稳定性；本次使用不可写/非法目标路径覆盖“写入失败”反馈与半成品安全。发布前建议在独立 APFS 沙箱卷或 CI 临时卷补做真实 ENOSPC 测试。
- macOS 应用签名仍因缺少有效 Developer ID Application 证书被跳过。这是既有 C-02/C-05 发布阻塞，不影响本地 D-08 功能验收结论。
