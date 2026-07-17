# D-07 主题、语言、窗口适配与基础可访问性验收记录

- 日期：2026-07-18
- 任务：D-07 验收主题、语言和窗口适配
- 范围：中英文切换、四种主题、窄窗口、高 DPI、键盘导航、弹窗焦点和屏幕阅读器基础语义
- 结论：通过。已修复验收中发现的基础语义与默认 guest 语言一致性问题。

## 数据保护

- 验收前关闭 LifeOS，并将真实数据目录 `/Users/mac/LifeOS` 临时移动到 `/Users/mac/LifeOS.codex-d07-backup-20260718-001`。
- 使用空 `/Users/mac/LifeOS` 执行打包应用验收。
- 验收结束后，测试数据已移动到 `/tmp/LifeOS.codex-d07-evidence-20260718-001`。
- 真实数据已恢复回 `/Users/mac/LifeOS`。

## 验收包

- 应用：`dist_electron/mac/LifeOS.app`
- DMG：`dist_electron/LifeOS-1.0.2.dmg`
  - SHA256：`aad3c9bcb0530c063e64a6bde31888423d025177457f08ad896c40ff8258ce78`
- ZIP：`dist_electron/LifeOS-1.0.2-mac.zip`
  - SHA256：`ee70475deb3f589fd797cd1305f428809c1d4522fc798d5ee820fb903abfa019`

## 发现与修复

| 问题 | 处理 | 结果 |
| --- | --- | --- |
| Topbar 的主题、语言图标按钮只有图标和 `title`，屏幕阅读器可访问名称不稳定。 | 为主题/语言按钮增加本地化 `aria-label`；新增 `topbar.switch_language` 中英文文案。 | 通过，最终报告中可见按钮空名称数量为 0。 |
| English UI 中默认 guest 资料仍显示中文“访客模式”。 | 仅当 `userId === 'guest'` 时使用 `sidebar.guest_profile` 本地化显示；用户自定义昵称不受影响。 | 通过，English 验收状态显示 `Guest Mode`，未再出现中文 guest 标签。 |
| 全局搜索命令面板缺少 `role="dialog"` / `aria-modal`，输入框缺少显式可访问名称。 | 为命令面板增加 `role="dialog"`、`aria-modal="true"`、本地化 `aria-label`；为搜索输入框增加本地化 `aria-label`。 | 通过，最终报告中弹窗语义标签为“全局搜索”，未命名输入为 0，Escape 可关闭。 |

## 自动验收摘要

证据目录：`/tmp/lifeos-d07-playwright-evidence-20260718-001`

- JSON 报告：`d07-validation-report.json`
- 截图证据：
  - `d07-dashboard-chinese-minimal.png`
  - `d07-dashboard-english.png`
  - `d07-narrow-retina-emulation.png`
  - `d07-search-dialog-open.png`

最终自动验收报告：

| 检查项 | 结果 |
| --- | --- |
| 初始中文 Minimal 主题 | 通过；`theme-minimal`；无空名称按钮；无横向溢出。 |
| 切换 English | 通过；主要导航、标题、按钮切换为 English；guest 显示为 `Guest Mode`。 |
| English 持久化 reload | 通过；reload 后仍为 English。 |
| 切回中文 | 通过；主要 UI 恢复中文。 |
| 四主题循环 | 通过；`theme-dense`、`theme-card`、`theme-dark-tech`、`theme-minimal` 均可切换。 |
| 窄窗口 + 高 DPI 近似 | 通过；`820x620@2` 下 `scrollWidth/clientWidth = 820/820`，无横向溢出。 |
| 键盘导航 | 通过；连续 Tab 后焦点可移动，无焦点陷阱。 |
| 全局搜索弹窗 | 通过；具备 `role="dialog"`、`aria-modal="true"`、可访问标签；输入框有可访问名称。 |
| Escape 关闭弹窗 | 通过；关闭后 `dialogCount = 0`。 |

最终报告失败项：`[]`

## 验证命令

```bash
npm test
npm run build
npm run lint
npm run build:app
shasum -a 256 dist_electron/LifeOS-1.0.2.dmg dist_electron/LifeOS-1.0.2-mac.zip
```

交互验收通过 Electron 远程调试端口执行，覆盖语言、主题、窗口尺寸、高 DPI、键盘与弹窗语义。

## 已知限制

- 本机仍缺少有效 Developer ID Application 证书，`electron-builder` 跳过 macOS 应用签名。这是既有 C-02/C-05 发布阻塞，不影响本地功能与 D-07 验收结论。
- 高 DPI 使用 Electron/Chromium `deviceScaleFactor: 2` 近似验收；最终发布前仍建议在目标 Retina 设备上做一次人工视觉复核。
