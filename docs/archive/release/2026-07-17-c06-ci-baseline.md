# C-06 CI 基线

日期：2026-07-17
任务：C-06
状态：已完成配置，等待 GitHub Actions 首次运行

## 1. 工作流

新增：`.github/workflows/ci.yml`

触发条件：

- push 到 `main`。
- 针对 `main` 的 pull request。

执行环境：

- `ubuntu-latest`
- Node.js `24.18.0`
- `npm ci`，使用 `package-lock.json` 确保依赖可复现。

门禁步骤：

1. 安装依赖并重建原生模块。
2. `npm test`。
3. `npm run build`。
4. `npm run lint`。

## 2. 范围与限制

- CI 验证源码、测试和构建 bundle，不执行 macOS 签名、公证或 DMG 发布。
- electron-builder 产物和真实升级演练仍由 C-02 至 C-05 的发布环境负责。
- Windows / Ubuntu 的发布级行为不因 Ubuntu CI 通过而视为完成。
- 工作流权限限制为 `contents: read`，不自动发布、不写入 Release。

## 3. 本地验收

- `npm test`：238 + 20 + 11 + 10 项全部通过。
- `npm run build`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- YAML 文件已检查触发器、Node 版本、依赖缓存和步骤顺序。

## 4. 首次运行后的检查

合并工作流后，项目负责人需要确认：

- GitHub Actions 能够正常安装 `better-sqlite3` 并运行 Electron-as-Node 测试。
- 测试、构建、Lint 失败会阻止合并。
- 主分支保护规则已将 `verify` job 设置为必需检查。
- 不将 CI 成功误认为 macOS 签名、公证或升级演练通过。

## 5. 结论

C-06 已完成基础 CI 配置。后续只需在 GitHub 侧完成首次运行和分支保护设置，即可把现有本地质量门禁接入 PR 与主分支流程。
