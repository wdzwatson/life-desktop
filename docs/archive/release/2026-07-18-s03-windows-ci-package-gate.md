# S-03 Windows CI 打包与产物门禁

- 日期：2026-07-18
- 状态：配置与本地验证完成，等待 GitHub Windows runner 首次运行
- 目标：让 Windows `npm run build:app` 在原生环境自动执行并验证真实产物

## 1. 修改

- 在 `.github/workflows/ci.yml` 增加 `windows-package` job。
- 使用 `windows-latest` 和 Node.js 24.18.0。
- Windows job 依次执行：
  1. `npm ci`
  2. `npm test`
  3. `npm run lint`
  4. `npm run build:app`
  5. `npm run verify:package:win`
- 上传 NSIS 安装器、blockmap、ZIP 和 `latest.yml`，保留 7 天。
- 新增 `scripts/verify-windows-package.mjs`，验证：
  - NSIS 安装器存在且非空。
  - Windows ZIP、blockmap、`latest.yml` 存在且非空。
  - `win-unpacked/LifeOS.exe` 为 PE/x64。
  - 包内 `better_sqlite3.node` 为 PE/x64。
  - 更新 metadata 版本、安装器路径和 checksum 字段存在。
- 原生二进制检查改为最多读取 64 KiB 文件头，避免验证大型安装器时把整个文件载入内存。

## 2. 本地验证

| 检查 | 结果 |
| --- | --- |
| Windows 产物专项测试 | 2 / 2 通过 |
| 原生格式与 Windows 产物组合测试 | 5 / 5 通过 |
| 历史错误交叉包 | 正确拒绝，发现包内 Mach-O/x64，预期 PE/x64 |
| 全量测试 | 243 + 20 + 11 + 10 全部通过 |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| GitHub Actions YAML 解析 | 通过 |
| Prettier 检查 | 通过 |
| `git diff --check` | 通过 |

## 3. 对其他功能的影响

- Ubuntu 原有 test / build / lint job 保持不变。
- Windows job 使用独立 runner，不影响 macOS 本地打包和发布凭据。
- 工作流权限仍为 `contents: read`，不会自动发布 Release 或写入仓库。
- 数据库、保险箱、备份恢复、任务、笔记、书籍和视频全量测试未发现回归。

## 4. 待外部验收

当前分支尚未推送到 GitHub，因此不能宣称 Windows runner 已实际通过。解除该项需要：

1. 获得推送授权并把当前提交推送到 `main` 或测试分支。
2. 等待 GitHub Actions 的 `windows-package` job 完成。
3. 下载 CI 产物，在 Windows 10/11 x64 启动、安装、创建数据库记录并重启验证。

## 5. 结论

Windows 原生打包 CI、产物完整性检查和错误平台原生模块拦截已经实现并通过本地自动化验证。真实 Windows 构建结论保留为“等待 GitHub Windows runner 首次运行”，未作虚假通过声明。
