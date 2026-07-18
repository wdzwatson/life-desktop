# S-01 adm-zip 高危漏洞修复

- 日期：2026-07-18
- 状态：已完成
- 类型：生产依赖安全修复
- 影响范围：备份与恢复、EPUB / DOCX 读取、视频工具 ZIP 解压

## 1. 问题

依赖审计发现 `adm-zip@0.5.18` 命中高危安全公告 `GHSA-xcpc-8h2w-3j85`。特制 ZIP 文件可能触发约 4GB 内存分配。LifeOS 会读取用户提供的备份包、EPUB、DOCX 和下载的视频工具压缩包，因此该问题属于真实输入边界风险。

## 2. 修改

- 将生产依赖 `adm-zip` 从 `^0.5.18` 升级到 `^0.6.0`。
- 更新 `package-lock.json`。
- 保持现有备份清单校验、路径边界检查、checksum 校验和原子恢复逻辑不变。

## 3. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| 备份与恢复专项测试 | 2 / 2 通过 |
| 全量测试 | 238 + 20 + 11 + 10 全部通过 |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，DMG / ZIP / blockmap 生成成功 |
| EPUB ZIP 往返读取 | 通过 |
| DOCX ZIP 往返读取 | 通过 |
| 视频工具 ZIP Buffer 解压 | 通过 |
| `git diff --check` | 通过 |

## 4. 回归影响

- 备份创建、清单读取、checksum 校验、恢复 staging 和失败回滚测试均通过。
- EPUB 的 `META-INF/container.xml` 与 OPF 条目读取兼容。
- DOCX 的 `word/document.xml` 条目读取兼容。
- 视频工具安装使用的 Buffer ZIP 解压方式兼容。
- 数据库、保险箱、任务、笔记、书籍、视频和本地化全量测试未发现回归。

## 5. 已知外部条件

`npm run build:app` 仍因本机没有有效 Developer ID Application identity 而跳过 macOS 签名。该条件属于既有 R-01 阻塞，不是本次依赖升级引入的问题。

## 6. 结论

`adm-zip` 高危漏洞已修复，生产依赖审计清零，相关压缩包处理路径和其他核心功能回归通过。
