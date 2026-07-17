# A-08 最小用户数据备份

日期：2026-07-17  
任务：A-08  
状态：已完成  
依赖：A-07 用户数据与备份边界

## 1. 交付内容

- 主进程备份服务：`electron/backup/service.ts`
- 备份 IPC：`backup:selectDirectory`、`backup:create`
- Preload API：`selectBackupDirectory`、`createBackup`
- 设置页入口：`src/views/Settings.tsx` 的“数据与备份”页签
- 中英文文案：`src/locales/zh-CN.json`、`src/locales/en-US.json`
- 自动化测试：`tests/backupService.test.ts`

## 2. 备份文件格式

备份输出为：

```text
lifeos-backup-<userId>-<UTC timestamp>.zip
```

ZIP 根目录包含：

| 路径 | 内容 |
|---|---|
| `manifest.json` | 格式版本、应用版本、来源平台、创建时间、用户 ID、包含范围与文件校验清单 |
| `config/settings.json` | 全局设置和用户配置 |
| `users/<userId>/database/` | 当前用户数据库文件；备份前先关闭数据库连接，避免遗漏 WAL 中的最新写入 |
| `users/<userId>/files/notes/` | 笔记文件 |
| `users/<userId>/files/books/` | 书籍文件 |
| `users/<userId>/files/videos/` | 默认视频目录中的视频文件 |

`manifest.json` 的 `files` 数组为每个归档文件记录归档路径、字节数和 SHA-256。恢复流程可据此进行版本检查与完整性校验。

## 3. 明确排除与外部依赖

- `vault-sensitive-backups/` 永不进入普通备份包，避免旧版密码库明文恢复文件被意外复制。
- `tools/video/` 不属于用户备份目录，因此不会被导出。
- 外部视频目录不自动复制；如果设置了外部目录，路径会写入 `manifest.includes.externalVideoDirectory`，由未来恢复流程提示用户重新挂载。
- 当前实现导出当前用户，不导出其他用户的数据库和文件。

## 4. 设置页行为

1. 用户选择目标目录。
2. 选择成功后启用“创建备份”。
3. 创建过程中按钮显示“正在创建…”，防止重复触发。
4. 成功后显示 ZIP 路径、归档文件数，并提供 Finder 定位。
5. 失败时显示主进程返回的失败原因；原始用户数据不做删除或覆盖。

## 5. 验收证据

- 聚焦备份测试：通过。
- 全量测试：237 + 20 + 11 + 10 项全部通过。
- TypeScript / Vite / Electron 构建：通过。
- ESLint：通过。
- `git diff --check`：通过。
- Electron 启动冒烟：成功监听 DevTools 端口，随后正常结束进程。

## 6. 已知限制与后续任务

- 当前为最小导出，不提供恢复、增量备份或实时百分比进度；“正在创建…”是阶段性状态反馈。
- 超大视频目录会使 ZIP 创建耗时较长，未来可增加媒体选择和异步进度事件。
- A-09 负责备份选择、兼容性检查、恢复前确认、失败回滚和恢复完成提示。

## 7. 结论

A-08 的最小备份交付满足当前 RC 计划：用户可从设置页选择目标目录，导出当前用户的任务、笔记、书籍、默认视频、数据库和必要配置，并通过 manifest 校验清单验证归档完整性；敏感旧密码库备份保持排除。
