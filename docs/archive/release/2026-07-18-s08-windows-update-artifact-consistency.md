# S-08 Windows 更新产物与 metadata 一致性

- 日期：2026-07-18
- 状态：配置与自动化校验已完成，Windows runner 首跑待外部触发

## 1. 调查结论

electron-builder 的 NSIS 默认行为存在两套名称：

- 本地安装器：`LifeOS Setup 1.0.2.exe`
- GitHub provider 写入 `latest.yml` 的安全名称：`LifeOS-Setup-1.0.2.exe`

原因是 GitHub 发布资产名称只允许安全字符，electron-builder 会把带空格的安装器名称转换后写入更新 metadata。此前 CI 上传的是本地带空格文件，而校验脚本只检查 `path` 以 `.exe` 结尾，没有确认 metadata 指向真实上传资产。人工把 Actions 产物上传到 Release 时，存在 `latest.yml` 指向不存在文件的风险。

## 2. 修改方案

1. 在 NSIS 配置中显式设置安全产物名称：
   - `${productName}-Setup-${version}.${ext}`
   - v1.0.2 实际结果应为 `LifeOS-Setup-1.0.2.exe`
2. GitHub Actions 上传规则同步改为安全文件名及其 blockmap。
3. Windows 产物校验新增以下门禁：
   - NSIS 文件名必须是 GitHub Release 安全名称。
   - `latest.yml` 版本必须等于 `package.json` 版本。
   - 顶层 `path` 必须与真实安装器文件名完全一致。
   - `files[].url` 必须引用同一安装器。
   - `files[].size` 必须等于真实文件大小。
   - 顶层和文件条目的 SHA-512 都必须等于真实安装器 checksum。
   - 安装器、blockmap、ZIP、`latest.yml`、PE/x64 主程序与 PE/x64 原生模块仍必须存在且非空。

## 3. 专项测试

`node --test tests/windowsPackageVerification.test.mjs`：5/5 通过。

| 场景 | 结果 |
| --- | --- |
| 完整 PE/x64 Windows 产物与正确 metadata | 通过 |
| 混入 macOS 原生模块 | 正确阻断 |
| metadata 指向其他安装器 | 正确阻断 |
| metadata size 与真实文件不一致 | 正确阻断 |
| metadata SHA-512 与真实文件不一致 | 正确阻断 |

`npm run lint` 和相关文件 Prettier 检查均通过。

## 4. 全量回归

| 命令 | 结果 |
| --- | --- |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| `npm test` | 通过，249 + 20 + 11 + 10，0 failed、0 skipped |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，macOS DMG、ZIP 与 blockmap 正常生成 |

## 5. 最终本地产物快照

本任务是本轮最后一个本地变更，以下 checksum 替代 S-06 作为当前工作区最新 macOS 构建快照：

| 文件 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| `dist_electron/LifeOS-1.0.2.dmg` | 157649223 | `e0c51803065fc15404c16bed7c51cf79f37fa6f66ed69404f64b3fc4309cf72e` |
| `dist_electron/LifeOS-1.0.2-mac.zip` | 157214675 | `66d556d4b9d123899b44a316efd6a04e49655ab3fd8724d65b482cdddd13c9b4` |

`latest-mac.yml` 的路径、size 和 SHA-512 已与上述本地文件重新计算结果核对一致。产物仍未完成 Developer ID 签名和 Apple 公证，只能用于内部受控验证。

## 6. 未完成边界

- 当前 macOS 环境不能代替真实 Windows runner 生成和验收 NSIS、Windows ZIP 与 `latest.yml`。
- 当前分支尚未推送，GitHub Actions 的 Windows job 还没有首次真实运行记录。
- 推送后必须确认上传资产实际名称为：
  - `LifeOS-Setup-1.0.2.exe`
  - `LifeOS-Setup-1.0.2.exe.blockmap`
  - `LifeOS-1.0.2-win.zip`
  - `latest.yml`
- 只有 runner 中 `npm run verify:package:win` 通过后，才能宣称 Windows 打包与 metadata 真实验收通过。

## 7. 验收结论

S-08 的本地可执行部分已完成。Windows 安装器名称与 GitHub 更新 metadata 已在配置层统一，校验脚本能够阻断路径、大小和 checksum 不一致，完整回归未发现对其他功能或 macOS 打包的干扰。剩余 Windows runner 首跑属于外部执行条件，不由本地代码继续提前宣称完成。
