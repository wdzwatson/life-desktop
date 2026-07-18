# S-05 CI 高危依赖审计门禁

日期：2026-07-18  
状态：已完成

## 1. 目标

把本地执行的依赖漏洞检查固化到持续集成流程，避免高危或严重等级的已知漏洞在后续变更中绕过合并检查。

## 2. 修改内容

- Ubuntu `verify` job 在 `npm ci` 后执行 `npm audit --audit-level=high`。
- Windows `windows-package` job 在 `npm ci` 后执行同一审计命令。
- 任一平台发现 high 或 critical 漏洞时，对应 CI job 立即失败，不再继续测试或打包。

## 3. 专项验证

| 验证项 | 结果 |
| --- | --- |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| CI 审计步骤数量检查 | 通过，Ubuntu 与 Windows 共 2 处 |
| 审计步骤位置 | 通过，均位于 `npm ci` 之后、测试之前 |

## 4. 全量回归

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过，246 + 20 + 11 + 10，0 failed、0 skipped |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，生成 DMG 与 macOS ZIP |

## 5. 影响评估

- 本任务只修改 CI 流程，不改变应用运行时逻辑、用户数据或打包目标。
- 审计阈值固定为 high，moderate/low 不会阻断 CI。
- Windows job 的真实远端执行仍需分支推送后由 GitHub Actions runner 验证；本次只完成配置、静态检查和本机回归。
- macOS 打包仍因缺少有效 Developer ID Application identity 跳过签名，属于既有发布阻塞，与本任务无关。

## 6. 验收结论

S-05 已完成。后续提交在 Ubuntu 测试构建和 Windows 打包流程中都会自动检查 high/critical 依赖漏洞，当前回归未发现对其他功能的干扰。
