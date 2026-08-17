# PDF/EPUB 章节感知批注与导出验收记录

日期：2026-08-17

范围：AT-15 迁移、目录深度、异常容错、性能和跨格式验收

## 结论

- 通过。旧 `highlights` 兼容链、任意深度目录、异步章节回填和三类批注导出均有自动化覆盖。
- 目录分析仍位于 Electron Worker；PDF 首屏、选择、翻页、滚动、OCR 请求和窗口调整不等待目录分析。
- 目录解析失败不删除选区或批注正文。仍为 `pending` 的同源选区转为 `error`，可以继续编辑和导出；失败结果不缓存，可重新分析。
- 5,000 层目录改用迭代索引，避免递归栈溢出；循环父链会确定性断开并提升为根节点。

## 固定样本

样本由 `scripts/generate-reader-at15-fixtures.py` 生成，存放于 `docs/archive/qa/assets/reader-at15/`。

| 样本 | 大小 | SHA-256 | 验收结果 |
| --- | ---: | --- | --- |
| `at15-multicolumn-deep-outline.pdf` | 10,982 B | `D80DA46007660E34CE7E4417B5E25644E9D6988FAAC8641D52F1D56E780F16A9` | `TextBased`，8 页，PDF.js 原生目录深度 8 |
| `at15-scanned.pdf` | 42,579 B | `A3D8417A7FAC16B51B7751FCDDE401933ECB402247D48E16B8EFC01630FAC87C` | `Scanned`，仅第 1 页需要 OCR |
| `at15-mixed.pdf` | 35,132 B | `FCF1519443CE3CE3FE9180F5B9322A34DB86BDB965CE6C3AB5055094F2AE718D` | `Mixed`，仅第 2 页需要 OCR |
| `at15-corrupt.pdf` | 17,566 B | `1FEA964462D5F449C6A969E89889CAE0EA7428EFA33E4035E2F1FFD6FDF59BFD` | `pdf-inspector` 和 PDF.js 均拒绝，进入可重试错误路径 |
| `at15-deep-outline.epub` | 5,242 B | `B08B123A08B65017C6BD59CF0E0FA57FFB13E37177188B2CECD3B0EBFE2D92BB` | EPUB3 包结构有效，8 个章节、8 级嵌套导航 |

另复用 `docs/archive/qa/assets/d05/d05-reader-sample.pdf` 验证无目录文本 PDF，并使用 320 页合成契约验证大文件的有限页面窗口行为。

## 自动化矩阵

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| 旧数据迁移数量与幂等 | 两次迁移后 legacy/selection/item 数量均为 2 | 通过 |
| 三级、五级和更深目录 | 8 级真实 PDF/EPUB；5,000 层合成树 | 通过 |
| 完整章节来源 | 8 级路径回填到跨页选区并进入导出记录 | 通过 |
| 跨页选择 | 页 8 到页 9 positions、页码与矩形往返 | 通过 |
| 三类批注 | translation/underline/note 独立保存、样式和筛选契约 | 通过 |
| page-only/error | 可编辑并进入 Markdown、HTML、DOCX | 通过 |
| 重复 Notes 同步 | 稳定标记替换；删除条目消失；手写前后区保留 | 通过 |
| HTML/DOCX | 三类标签、颜色、正文和深链接保留；DOCX 为有效 OOXML | 通过 |
| 缓存 miss/hit | 首次 worker 解析，第二次按 hash/version/pageCount 命中且保留原分析来源 | 通过 |
| 失败与重试 | 失败不缓存，pending 转 error，下一次可成功重跑 | 通过 |
| 取消和旧任务隔离 | 同书新任务取消旧 worker，旧结果不回写 | 通过 |
| OCR 页面识别 | 扫描 `[0]`，混合 `[1]`，均为 0 基页索引 | 通过 |
| 缩放重绘 | 百分比矩形与 Anchor v2 往返测试，不改变页面尺寸 | 通过 |

关键测试文件：

- `tests/readerPdfFixtures.test.ts`
- `tests/readerAnnotation.integration.test.ts`
- `tests/readerPerformanceBaseline.test.ts`
- `tests/readerOutlineService.test.mjs`
- `tests/outlineIndex.test.ts`

## 性能与交互

性能清单升级为 version 2，门槛如下：

| 操作 | 门槛 | 本次结果 |
| --- | ---: | --- |
| 5,000 层目录索引 | < 2,000 ms | 通过；最终全量运行约 191 ms |
| 5,000 节点目录树构建 | < 1,000 ms | 通过 |
| 10,000 条批注规范化与排序 | < 2,000 ms | 通过 |
| 选择保存确认 | < 120 ms，且不等待 outline | 静态编排契约通过 |
| 翻页与滚动帧 | <= 16 ms，且不等待 outline | 静态编排契约通过 |

这些预算测试只覆盖本地纯计算，不将 CI/开发机差异当成产品首屏遥测。真实目录分类和 Markdown 推断继续在 Worker 中执行，renderer 不直接调用 `pdf-inspector`。

## 可视与浏览器检查

- `pdf:pdf` 流程使用 Poppler 渲染并检查四个 PDF；第二版样本无文字重叠、裁切或不可读问题。
- 应用内 Browser：`http://127.0.0.1:5174/`，Chromium，1280 x 720 与 800 x 720。
- 页面身份、非空内容、无框架错误覆盖层、控制台 error/warn、书库到笔记再返回书库的交互均通过。
- 800 x 720 下 `body.scrollWidth === innerWidth`，无水平溢出；按钮和空态文字保持可读。
- Electron 主窗口配置 `minWidth: 800`。430 x 850 不是受支持的桌面窗口尺寸，因此不把该宽度下的既有空态溢出作为 AT-15 回归。

## 门禁

- 针对性 reader 测试：通过。
- `npm test`：通过。
- `npm run lint`：通过。
- `npx tsc -b --pretty false`：通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- `npm audit --omit=dev`：发现 5 项现有生产依赖漏洞（2 moderate、3 high）。`npm audit fix --dry-run` 会跨功能更新 14 个传递依赖，并与仓库的 `brace-expansion` 本地 override 产生异常变更，因此未在 AT-15 中自动修复；这些漏洞不是本任务新增依赖引入。

## 已知边界

- 普通浏览器没有 Electron 本地书籍数据库和系统保存对话框，真实文件选择/保存对话框不在浏览器检查范围；数据库、PDF.js、`pdf-inspector`、DOCX OOXML 和保存服务由 Node/Electron 自动化覆盖。
- `pdf-inspector` 只用于结构分类和 Tagged/Markdown fallback；PDF 页面显示、选择、坐标、原生书签及现有首屏封面生成仍由 PDF.js/现有封面服务负责。
- 旧 `highlights` 表继续保留，尚未进入删除阶段。
