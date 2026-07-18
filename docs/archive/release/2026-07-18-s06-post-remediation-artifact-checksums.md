# S-06 整改后安装产物校验记录

- 日期：2026-07-18
- 构建基线：`5b96056`
- 应用版本：`1.0.2`
- 状态：本地构建与完整性校验通过，未签名、未公证

## 1. 构建与回归结果

| 命令 | 结果 |
| --- | --- |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| `npm test` | 通过，246 + 20 + 11 + 10，0 failed、0 skipped |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，生成 DMG、macOS ZIP、blockmap 和 `latest-mac.yml` |

## 2. 产物清单

| 文件 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| `dist_electron/LifeOS-1.0.2.dmg` | 157677504 | `05d510795f0c4af953cf2d3c3ad5ec6bc7708e8e6dbc4b1e9428b104bc6c8fb9` |
| `dist_electron/LifeOS-1.0.2-mac.zip` | 157214603 | `f6cd21ed10a26ff40767d8c858ffead458c784047642bff9eafbdb9732e3d995` |

构建时间：

- DMG：2026-07-18 14:12:44 +0800
- ZIP：2026-07-18 14:12:54 +0800

## 3. 更新元数据一致性

`latest-mac.yml` 中记录的文件名、大小和 SHA-512 已与本地产物重新计算结果逐项比对：

| 文件 | metadata 路径 | size | SHA-512 |
| --- | --- | ---: | --- |
| macOS ZIP | `LifeOS-1.0.2-mac.zip` | 157214603 | 匹配 |
| DMG | `LifeOS-1.0.2.dmg` | 157677504 | 匹配 |

默认更新入口 `path` 指向 `LifeOS-1.0.2-mac.zip`，与实际文件一致。

## 4. 使用边界

- 本机没有有效 Developer ID Application identity，electron-builder 已跳过签名。
- 产物没有完成 Apple notarization、staple 或 Gatekeeper 验收。
- 这些文件只能用于内部受控验证，不得作为公开正式发布物。
- electron-builder 产物包含构建时间等非确定性内容；任何后续重新打包都会产生新的 checksum，必须新增后续校验记录，不能沿用本表。

## 5. 验收结论

S-06 已完成。当前构建产物可读取、文件非空，SHA-256 已归档，`latest-mac.yml` 的大小与 SHA-512 和实际文件一致。该结论只证明本次本地构建完整性，不替代签名、公证、公开发布或真实自动更新验收。
