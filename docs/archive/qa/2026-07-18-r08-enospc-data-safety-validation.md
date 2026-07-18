# R-08 真实 ENOSPC 数据安全验收

- 日期：2026-07-18
- 状态：已完成
- 环境：独立 64 MiB APFS sparsebundle 临时卷
- 测试对象：LifeOS 备份创建流程

## 1. 安全边界

- 未在系统盘制造满盘场景。
- 未读取、移动或修改真实 `~/LifeOS` 数据。
- 使用 `/tmp` 下的合成 LifeOS 数据目录和随机测试文件。
- 测试结束后强制卸载临时卷并删除磁盘映像和合成数据。

## 2. 测试数据

- APFS 测试卷容量：64 MiB。
- 合成视频文件：96 MiB，不可压缩随机内容。
- 备份内容：测试设置文件、guest 用户目录和随机视频文件。
- 触发动作：调用真实 `createLifeOsBackupPackage` 写入受限 APFS 卷。

## 3. 首轮结果与发现

首轮成功触发真实文件系统错误：

```text
code: ENOSPC
message: ENOSPC: no space left on device, write
```

应用没有返回成功，源文件 SHA-256 保持不变，但目标目录残留了同名不完整 ZIP。该行为不会破坏源数据，但会给用户留下不可用半成品，因此本轮直接修复。

## 4. 修复

- 新增 `writeBackupArchive` 写入边界。
- `zip.writeZip` 抛出错误时立即删除目标路径上的不完整归档，然后保留原始错误继续抛出。
- 新增自动化测试，通过模拟 ENOSPC 写入确认：
  - 错误仍可被调用方识别。
  - 半成品归档被删除。
  - 源文件保持不变。

## 5. 修复后真实复测

第二次使用全新的 64 MiB APFS 测试卷执行相同场景：

| 验收项 | 结果 |
| --- | --- |
| 真实 ENOSPC 被触发 | 通过 |
| 错误代码 | `ENOSPC` |
| 错误信息可理解 | `ENOSPC: no space left on device, write` |
| 是否误报成功 | 否 |
| 目标目录残留半成品 | 否，`outputEntries: []` |
| 源文件 checksum | 前后一致 |
| 源文件 SHA-256 | `c009ac9878502d1f0e233a14f03b7ec0d5af4193433a2ad86c3f64768e6e38b7` |
| 临时卷清理 | 已卸载并删除 |

## 6. 回归结果

| 检查 | 结果 |
| --- | --- |
| 备份专项测试 | 3 / 3 通过 |
| 全量测试 | 246 + 20 + 11 + 10 全部通过 |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，DMG / ZIP / blockmap 生成成功 |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| `git diff --check` | 通过 |

正常备份、清单校验、原子恢复、敏感 vault 备份保留、数据库、任务、笔记、书籍和视频流程未发现回归。

## 7. 已知外部条件

macOS 安装包仍因本机没有有效 Developer ID Application identity 而跳过签名，属于既有 R-01 阻塞，与 ENOSPC 修复无关。

## 8. 结论

R-08 已完成。LifeOS 在真实 APFS ENOSPC 条件下能够明确失败、不误报成功、不破坏源数据，并且不会残留不完整备份包。
