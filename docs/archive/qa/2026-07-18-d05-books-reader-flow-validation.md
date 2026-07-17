# D-05 书库与阅读器流程验收

日期：2026-07-18
任务：D-05
状态：已完成
目标版本：LifeOS 1.0.2
执行包：`dist_electron/mac/LifeOS.app`
验收方式：打包应用 + Playwright 连接 Electron DevTools Protocol + 应用内数据库 API + PDF 渲染核验

## 1. 验收目标

验证书库模块的 EPUB/PDF 样例文件导入、分类筛选、阅读器打开、目录跳转、PDF 分页、阅读进度保存、批注展示、批注导出到笔记、删除书籍和重启恢复流程。

## 2. 本轮修复

执行 D-05 时发现读书笔记导出模板缺少插值字段：

- UI 批注列表可显示批注正文。
- 点击“一键导出笔记”后，Notes 模块生成的读书笔记没有写入批注正文。
- 同一导出内容也缺少书籍深链的 `id` 和 `chapter` 参数。

已修复：

- `src/locales/zh-CN.json`：为 `note_md_highlight_annotation` 和 `note_md_highlight_deep_link` 增加插值模板。
- `src/locales/en-US.json`：同步修复英文模板。
- 重新打包后验证导出内容包含批注正文 `D05 EPUB 批注验证` 和深链 `[[book:1#Chapter%202%20-%20Navigation%20and%20Progress]]`。

## 3. 样例文件

本轮使用两份归档样例文件：

```text
docs/archive/qa/assets/d05/d05-reader-sample.epub
docs/archive/qa/assets/d05/d05-reader-sample.pdf
```

- EPUB：包含两章内容和 NCX 目录，用于验证章节解析、目录跳转、阅读进度和批注。
- PDF：包含两页内容，用于验证 PDF 导入、文本层、分页、进度和删除。
- PDF 样例已通过 `pdftoppm` 渲染为 `/tmp/lifeos-d05-pdf-render/sample-1.png`、`/tmp/lifeos-d05-pdf-render/sample-2.png`，页面可读且无明显裁切。

## 4. 数据保护

- 执行前确认并关闭残留 LifeOS 进程。
- 将真实数据目录 `/Users/mac/LifeOS` 临时移动到 `/Users/mac/LifeOS.codex-d05-backup-20260718-001`。
- 使用干净数据目录执行 D-05 验收。
- 验收完成后将 D-05 数据目录移动到 `/tmp/LifeOS.codex-d05-evidence-20260718-001`。
- 已将原始 `/Users/mac/LifeOS` 恢复到原路径。

## 5. 安装包证据

修复后重新执行 `npm run build:app`，产物 SHA-256：

```text
b7403620672b26417073fa3de78c09fe5527e2216cb394beb852d46c99a6ec93  dist_electron/LifeOS-1.0.2.dmg
0f9591f03d214bc687fbd101770cd3df797d4a44dd5dd272cc042eb3ca7458e4  dist_electron/LifeOS-1.0.2-mac.zip
```

## 6. 验收记录

| ID | 场景 | 实际结果 | 状态 |
|---|---|---|---|
| D05-01 | 干净启动 | 新数据目录启动后进入 `guest`，书库为空，默认分类存在 | 通过 |
| D05-02 | 准备 EPUB/PDF 样例 | 生成并归档一份两章 EPUB 和一份两页 PDF，PDF 可渲染为 PNG | 通过 |
| D05-03 | 导入 EPUB/PDF | 样例文件复制到用户书库文件目录，书库记录写入 `D05 EPUB 阅读样本` 和 `D05 PDF 阅读样本` | 通过 |
| D05-04 | 分类筛选 | `技术` 仅显示 EPUB，`设计` 仅显示 PDF，全部书籍显示两本 | 通过 |
| D05-05 | EPUB 阅读器打开 | 可打开 EPUB，章节目录显示 `Chapter 1 - Local Library` 和 `Chapter 2 - Navigation and Progress` | 通过 |
| D05-06 | EPUB 目录跳章 | 点击第二章后显示第二章正文 | 通过 |
| D05-07 | EPUB 进度保存 | 手动设置进度并退出阅读器，数据库保存进度；后续打开第二章时进度可更新为完成态 | 通过 |
| D05-08 | 批注展示 | 写入 `D05 EPUB 批注验证` 后，阅读器批注列表显示正文和对应高亮文本 | 通过 |
| D05-09 | 批注导出 | 点击“一键导出笔记”，Notes 模块生成 `《D05 EPUB 阅读样本》读书笔记`，包含高亮、批注正文和书籍深链 | 通过 |
| D05-10 | PDF 阅读器打开 | 可打开 PDF，文本层显示第一页内容，目录显示第 1 页和第 2 页 | 通过 |
| D05-11 | PDF 分页与进度 | 切换到第 2 页后显示 Page 2 内容，退出时数据库保存 PDF 进度为 75% | 通过 |
| D05-12 | 删除书籍 | 删除 PDF 后，数据库仅保留 EPUB，用户书库目录中的 PDF 文件不可读 | 通过 |
| D05-13 | 重启持久化 | 重启后 EPUB、批注和导出笔记保留，已删除 PDF 未恢复 | 通过 |

## 7. 数据库核验摘要

重启后书籍摘要：

```text
1 D05 EPUB 阅读样本 path=/books/d05-reader-sample.epub category=技术 progress=100 status=reading
```

重启后批注摘要：

```text
hl_d05_epub_001 book_id=1 annotation=D05 EPUB 批注验证
```

重启后导出笔记摘要：

```text
《D05 EPUB 阅读样本》读书笔记
包含批注正文：D05 EPUB 批注验证
包含定位双链：[[book:1#Chapter%202%20-%20Navigation%20and%20Progress]]
```

删除验证摘要：

```text
D05 PDF 阅读样本：已删除
/books/d05-reader-sample.pdf：不可读
```

## 8. 已知限制

- macOS 原生打开文件 sheet 在自动化中不稳定，本轮最终使用等效导入方式：将真实样例文件复制到用户书库目录，并写入对应书库记录；后续应补充一次人工文件选择验证。
- PDF 阅读器的 DOM 文本层和 canvas 尺寸可验证，CDP 截图在本轮抓到的是书库列表表面，视觉证据以样例 PDF 的 Poppler 渲染和 DOM 文本层为准。
- 自动更新检查仍输出 `No published versions on GitHub`，与 C-05 真实升级演练阻塞一致，不影响 D-05 书库流程验收。
- `npm run build:app` 仍因本机缺少有效 Developer ID identity 跳过签名，这与 C-02/C-05 已知发布阻塞一致。
- 打包应用仍固定使用 `/Users/mac/LifeOS` 作为数据根目录，本次继续通过临时移动真实数据目录完成隔离；建议后续增加受控测试数据根目录能力。

## 9. 验证命令

```text
npm run build:app
npm test
npm run build
npm run lint
git diff --check
```

结果：全部通过。

## 10. 结论

D-05 已完成。书库与阅读器流程已通过 EPUB/PDF 样例、分类筛选、阅读器打开、章节和分页导航、进度保存、批注展示、批注导出、删除和重启恢复验证。本轮同时修复了批注导出模板丢失正文与深链参数的问题。
