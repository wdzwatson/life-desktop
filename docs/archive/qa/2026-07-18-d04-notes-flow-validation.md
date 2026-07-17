# D-04 笔记流程验收

日期：2026-07-18
任务：D-04
状态：已完成
目标版本：LifeOS 1.0.2
执行包：`dist_electron/mac/LifeOS.app`
验收方式：打包应用 + Playwright 连接 Electron DevTools Protocol + 原生保存对话框 + 应用内数据库 API + PDF 渲染核验

## 1. 验收目标

验证笔记模块的笔记本创建、Markdown 编辑、预览净化、笔记删除、Markdown/HTML/PDF 导出和重启恢复流程，并确认导出文件可打开、核心内容完整、恶意 HTML 不执行。

## 2. 本轮修复

本轮未修改业务代码。D-04 按既有打包应用执行端到端验收，未发现需要立即修复的 D-04 阻塞缺陷。

## 3. 数据保护

- 执行前确认并关闭残留 LifeOS 进程。
- 将真实数据目录 `/Users/mac/LifeOS` 临时移动到 `/Users/mac/LifeOS.codex-d04-backup-20260718-001`。
- 使用干净数据目录执行 D-04 验收。
- 验收完成后将 D-04 数据目录移动到 `/tmp/LifeOS.codex-d04-evidence-20260718-001`。
- 已将原始 `/Users/mac/LifeOS` 恢复到原路径。

## 4. 安装包证据

```text
37622551d21e0ff5cf4d14b0514b9c4c0dcf52ee675a68a45755b9e8a8f70c91  dist_electron/LifeOS-1.0.2.dmg
fbb0a896e78622d41ae47d1fba4567e9c3a2c24ef37ef39d2db7525f66eb3a43  dist_electron/LifeOS-1.0.2-mac.zip
```

## 5. 验收记录

| ID | 场景 | 实际结果 | 状态 |
|---|---|---|---|
| D04-01 | 干净启动 | 新数据目录启动后进入 `guest`，笔记为空 | 通过 |
| D04-02 | 创建笔记本 | 通过界面创建 `D04 验收笔记本`，分类为 `D04 验收分类`，数据库写入成功 | 通过 |
| D04-03 | 创建 Markdown 笔记 | 创建 `D04 Markdown 验收`，内容包含标题、加粗、内链、列表、表格和脚本注入样例 | 通过 |
| D04-04 | Markdown 预览 | 预览中加粗、列表、表格均正确渲染 | 通过 |
| D04-05 | 预览安全净化 | 预览容器无 `script` 元素，`window.__d04_xss` 未被置为 `true` | 通过 |
| D04-06 | Markdown 导出 | 导出 `/Users/mac/Downloads/D04 Markdown 验收.md`，源 Markdown 内容完整保留 | 通过 |
| D04-07 | HTML 导出 | 导出 `/Users/mac/Downloads/D04 Markdown 验收.html`，包含加粗与表格渲染结果，文件中无 `script` 标签 | 通过 |
| D04-08 | PDF 导出 | 导出 `/Users/mac/Downloads/D04 Markdown 验收.pdf`，文件大小约 93 KB，可渲染为 PNG | 通过 |
| D04-09 | PDF 视觉核验 | 渲染页中标题、正文、列表、表格均可读，无明显裁切、重叠或黑块 | 通过 |
| D04-10 | 删除笔记 | 新建 `D04 删除验证` 后通过界面删除确认，数据库仅保留主验收笔记 | 通过 |
| D04-11 | 重启持久化 | 完全退出并重启应用后，主笔记和笔记本恢复，删除验证笔记未恢复 | 通过 |
| D04-12 | 重启后安全复核 | 进入笔记页后预览仍无 `script` 元素，`window.__d04_xss` 仍未执行 | 通过 |

## 6. 数据库核验摘要

笔记最终摘要：

```text
1 D04 Markdown 验收 notebook=D04 验收笔记本
```

笔记本最终摘要：

```text
1 D04 验收笔记本 category=D04 验收分类
2 未分类 category=默认
```

删除验证摘要：

```text
D04 删除验证：已删除，重启后未恢复
```

## 7. 导出文件核验

```text
/Users/mac/Downloads/D04 Markdown 验收.md
/Users/mac/Downloads/D04 Markdown 验收.html
/Users/mac/Downloads/D04 Markdown 验收.pdf
```

- Markdown：源内容完整，包含标题、加粗语法、内链、列表、表格和脚本注入样例。
- HTML：内容已包装为可打开页面，Markdown 渲染结果完整，脚本标签被移除。
- PDF：通过 `pdftoppm` 渲染为 `/tmp/lifeos-d04-pdf-render/d04-note-1.png` 并完成视觉核验。

## 8. 已知限制

- 自动更新检查仍输出 `No published versions on GitHub`，与 C-05 真实升级演练阻塞一致，不影响 D-04 笔记流程验收。
- 打包应用仍固定使用 `/Users/mac/LifeOS` 作为数据根目录，本次继续通过临时移动真实数据目录完成隔离；建议后续增加受控测试数据根目录能力。
- PDF 文本抽取依赖在本机不可用，本轮以 Poppler 渲染和视觉核验作为可打开性与版面正确性的证据。
- 导出保存依赖 macOS 原生保存对话框，自动化时需要先激活 LifeOS 窗口再确认保存。

## 9. 验证命令

```text
npm test
npm run build
npm run lint
git diff --check
```

结果：全部通过。

## 10. 结论

D-04 已完成。笔记模块已通过创建笔记本、Markdown 编辑与预览、导出 Markdown/HTML/PDF、删除笔记、重启恢复和安全净化验证。当前无 D-04 级别剩余阻塞项。
