# PDF/EPUB 章节感知批注与导出原子任务

日期：2026-08-17

状态：待执行

方案基线：`docs/archive/project-plans/2026-08-17-reader-annotation-chapter-export-plan.md`

## 一、执行规则

- 每个任务只负责一个可验证的边界，完成后可以独立提交和回滚。
- 任何时刻最多一个任务处于“进行中”或“验证中”。
- 数据库、解析服务和导出服务先以纯函数/服务测试建立契约，再接入 UI。
- 目录分析属于增强能力：不得阻塞第一页、文本选择、翻页、滚动和窗口调整。
- 任务完成前必须运行针对性测试、`npm test`、`npm run lint`、`npm run build` 和 `git diff --check`；若环境导致某项不能执行，必须在任务记录中说明原因和替代验证。
- 不删除旧 `highlights` 表，直到迁移核对和线上兼容观察完成。

## 二、任务总览

| 编号 | 原子任务 | 阶段 | 依赖 | 初始状态 |
| --- | --- | --- | --- | --- |
| AT-01 | 建立阅读器性能基线和回归契约 | A | 无 | 待开始 |
| AT-02 | 共享领域类型、Anchor v2 与导出类型 | A | AT-01 | 待开始 |
| AT-03 | 章节树、解析运行和批注数据库表 | A | AT-02 | 待开始 |
| AT-04 | 旧 `highlights` 幂等迁移与兼容读取 | A | AT-02、AT-03 | 待开始 |
| AT-05 | PDF.js 原生目录读取适配器 | B | AT-02、AT-03 | 待开始 |
| AT-06 | `pdf-inspector` Worker fallback、缓存和取消 | B | AT-03、AT-05 | 待开始 |
| AT-07 | 任意深度章节树和页码/y 坐标定位索引 | B | AT-05、AT-06 | 待开始 |
| AT-08 | 选区异步章节归属与 `pending` 状态 | B | AT-02、AT-07 | 待开始 |
| AT-09 | 翻译、划线、批注三类独立保存流程 | C | AT-03、AT-08 | 待开始 |
| AT-10 | PDF/OCR/EPUB 统一批注覆盖层 | C | AT-02、AT-09 | 待开始 |
| AT-11 | 多级目录抽屉、懒渲染与状态反馈 | C | AT-07 | 待开始 |
| AT-12 | 批注栏分类、颜色、跳转和虚拟列表 | C | AT-09、AT-10 | 待开始 |
| AT-13 | 完整章节路径 Markdown/Notes 导出 | D | AT-09、AT-12 | 待开始 |
| AT-14 | HTML/DOCX/PDF 导出适配和深链接 | D | AT-13 | 待开始 |
| AT-15 | 迁移、目录深度、性能和跨格式验收 | E | AT-01 至 AT-14 | 待开始 |

## 三、原子任务详情

### AT-01 建立阅读器性能基线和回归契约

目标：在增强功能接入前记录当前阅读器的可见性能和关键行为，形成不可回退的测试门槛。

范围：

- 记录已有 PDF/EPUB 首屏、文本选择、翻页、滚动和 OCR 页面行为。
- 建立无目录、已有目录、大 PDF 和扫描 PDF 的最小样本集。
- 为目录分析定义“renderer 不同步解析”和“选择操作不等待解析”的测试断言。

预计文件：

- 新增 `tests/readerPerformanceBaseline.test.*`、`tests/fixtures/reader/*`。
- 视现有测试结构修改 `scripts/run-tests.mjs` 或测试配置。

测试与验收：

- 样本可重复加载，基线指标可记录。
- 后续任务能调用统一的性能断言；没有新增功能时现有回归全部通过。

完成记录：

- 完成日期：2026-08-17
- 提交：`7deafd8`
- 结果：新增 reader 基线清单与回归测试，覆盖 PDF/EPUB 首屏、文本选择、翻页、滚动和 OCR 的非阻塞契约；renderer 不直接同步解析目录，选择流程不等待目录结果。
- 验证：`npm test`、`npm run lint`、`npm run build`、`git diff --check` 通过

### AT-02 共享领域类型、Anchor v2 与导出类型

目标：定义跨 PDF、OCR、EPUB、数据库和导出的唯一数据契约。

范围：

- 新增 `ReaderAnchorV2`、`DocumentPosition`、`OutlinePathSnapshot`、`ReaderSelection`、`ReaderAnnotationItem`。
- 约束 `translation`、`underline`、`note` 的字段和语义样式 token。
- 定义 `ExportAnnotationRecord`、章节解析状态和运行状态。
- 提供旧 Anchor 到 v2 的纯转换函数，支持跨页 segments。

预计文件：

- 新增 `src/types/readerAnnotation.ts`。
- 新增 `src/services/readerAnnotationSerializer.ts`（仅类型、排序和规范化基础函数）。
- 新增对应单元测试。

测试与验收：

- 非法 kind、缺少翻译语言、空批注正文和坏 Anchor 被拒绝。
- 单页、跨页、EPUB 偏移和 page-only 定位均可序列化/反序列化且不丢字段。

完成记录：

- 完成日期：2026-08-17
- 提交：`5ca8260`
- 结果：新增统一阅读器批注领域契约，覆盖 `ReaderAnchorV2`、`DocumentPosition`、完整多级 `OutlinePathSnapshot`、三类批注、解析状态、运行状态和导出记录；新增序列化/规范化服务，支持旧 Anchor 到 v2 转换、跨页排序、EPUB 偏移、page-only 定位和深链接导出。
- 验证：`node --test --import tsx tests/readerAnnotationSerializer.test.ts tests/bookReaderUtils.test.ts`、`npm test`、`npm run lint`、`npm run build`、`git diff --check` 通过
- 风险/后续：当前仅建立 UI/DB 前的纯契约层；AT-03 需要把这些类型落到数据库 schema 和查询服务。

### AT-03 章节树、解析运行和批注数据库表

目标：落地任意深度目录和“选区 + 条目”两层持久化模型。

范围：

- 新增 `book_outline_nodes`、`book_outline_runs`、`reader_selections`、`reader_annotation_items` 表、索引、外键和幂等迁移。
- 保存 `source`、`parent_id`、`level`、`path_key`、坐标、置信度、解析器版本和内容哈希。
- 用 `location_status` 区分 `pending`、`resolved`、`page-only`、`error`。

预计文件：

- 修改 `electron/db/schema.ts`。
- 新增数据库服务/查询模块和 `tests/readerAnnotationSchema.test.*`。

测试与验收：

- 多级父子节点、级联删除、唯一运行记录和重复初始化均通过。
- 同一选区可关联三类条目；索引能按书籍、状态、章节快速查询。

完成记录：

- 完成日期：2026-08-17
- 提交：`95022f3`
- 结果：新增 books.db 的章节解析运行表、章节节点表、选区表和批注条目表，并建立按书籍/状态/路径/页码的索引；支持任意深度目录节点、运行幂等更新、选区与翻译/划线/批注三类条目的统一保存。
- 验证：项目 Electron 运行时针对性验证 `tests/readerAnnotationSchema.test.ts`，以及 `npm test`、`npm run lint`、`npm run build`、`git diff --check` 通过
- 风险/后续：selection 记录会在目录节点尚未落库时降级为路径快照；后续 AT-04/AT-07/AT-08 再把它们和目录解析结果、异步归属、旧数据迁移打通。

### AT-04 旧 `highlights` 幂等迁移与兼容读取

目标：让已有用户的划线和批注无损进入新模型。

范围：

- 将旧文本和 Anchor 转换为 `reader_selections`。
- `highlighted !== false` 映射为 `underline`，非空 `annotation` 映射为 `note`；不猜测旧翻译类型。
- 迁移保留旧表，提供双读/只读兼容和数量核对。

预计文件：

- 新增 `electron/readerAnnotationMigration.ts`。
- 修改数据库初始化和旧 highlights 查询路径。
- 新增迁移测试与可重复执行脚本。

测试与验收：

- 空 annotation、坏 Anchor、跨页旧数据和重复迁移均不丢条目、不重复插入。
- 迁移前后数量、原文、页码和旧链接行为可核对。

完成记录：

- 完成日期：2026-08-17
- 提交：`783613d`
- 结果：新增旧 `highlights` 的幂等迁移与兼容读取层；启动时自动把旧行镜像到 `reader_selections` / `reader_annotation_items`，并通过兼容视图让读路径改走新模型，同时保留旧表作为写入口。
- 验证：`npm test`、`npm run lint`、`npm run build`、`git diff --check` 通过
- 风险/后续：旧写入口仍然保留，后续 AT-09 会把实际保存流程切到新的翻译/划线/批注服务；AT-07/AT-08 会进一步补齐章节归属与异步定位。

### AT-05 PDF.js 原生目录读取适配器

目标：优先使用 PDF 自带书签，保持现有 PDF.js 文档生命周期不变。

范围：

- 在 PDF 文档成功加载后异步调用 `getOutline()`。
- 将任意深度 destination 解析为节点、父子关系、起始页和跳转 locator。
- 对空目录、坏 destination 和无法解析页码提供明确结果。

预计文件：

- 新增 `electron/readerOutlineService.ts` 或拆分 `src/services/pdfOutlineAdapter.ts`。
- 修改 `src/views/Books.tsx` 的加载编排回调。
- 新增 PDF.js mock 测试。

测试与验收：

- 原生目录优先级高于 fallback；深度超过两级不被截断。
- 目录读取失败不影响第一页渲染和文本选择。

完成记录：

- 完成日期：2026-08-17
- 提交：`18d941c`
- 结果：新增 PDF.js 原生 `getOutline()` 适配器，支持命名 destination、任意深度扁平化、父路径、页码/y 坐标解析和失败/空目录状态；PDF 阅读器在 `Document` 加载成功后异步读取 outline，优先展示原生目录，失败或空目录时回退页码目录。
- 验证：`node --test --import tsx tests/pdfOutlineAdapter.test.ts tests/bookReaderPresentation.test.ts`、`npm test`、`npm run lint`、`npm run build`、`git diff --check` 通过
- 风险/后续：当前只完成 PDF.js 原生目录读取和 renderer 展示，尚未写入 `book_outline_nodes`；AT-06/AT-07 将继续处理 fallback、缓存、取消和统一章节索引。

### AT-06 `pdf-inspector` Worker fallback、缓存和取消

目标：为无原生书签或 Tagged PDF 提供后台结构分析，同时隔离 Node API。

范围：

- 在 Electron Worker 中调用 `pdf-inspector` 的 Tagged PDF 结构和 Markdown 标题推断能力。
- 按内容哈希、解析器版本和页数缓存；同一本书同一时间只运行一个任务。
- 支持取消、重试、进度、错误和旧缓存继续展示。
- 通过窄 IPC 返回结构化节点，不把 Node/N-API 打进 React renderer。

预计文件：

- 新增 `electron/worker/pdfInspectorWorker.ts`。
- 修改 `electron/readerOutlineService.ts`、preload/IPC 类型和依赖清单。
- 新增 Worker、缓存命中、取消和失败测试。

测试与验收：

- 原生目录为空时按 Tagged -> inferred -> page-only 顺序 fallback。
- 大文件解析期间 renderer 可响应；切换书籍或关闭阅读器不会回写旧任务结果。

### AT-07 任意深度章节树和页码/y 坐标定位索引

目标：把解析结果转换为高效可渲染、可定位的章节结构。

范围：

- 建立 `childrenByParent` 和按 `(page_start, y_start, sort_order)` 排序的扁平索引。
- 为节点生成稳定 `path_key` 和完整路径快照。
- 以最大的不晚于选区起点的节点作为主节点，同位置优先最深节点。
- 支持跨章节选区的起止路径。

预计文件：

- 新增 `src/services/outlineIndex.ts` 或同等纯服务模块。
- 新增三级、五级、深层目录和跨页定位测试。

测试与验收：

- 定位复杂度不随批注数量线性扫描整棵树。
- 深层节点、同页不同 y、无目录和 page-only 情况均返回稳定结果。

### AT-08 选区异步章节归属与 `pending` 状态

目标：先保存用户选择，再异步补齐章节信息，保证交互优先。

范围：

- 复用 `Books.tsx` 当前 PDF.js/OCR/EPUB 选区数据，先写原文、Anchor 和页码。
- 目录索引就绪时立即解析；未就绪时保存 `pending` 并后台更新。
- 解析失败降级为 `page-only` 或 `error`，不回滚已保存条目。
- 跨章节选择保存起始和结束快照并标记跨章节。

预计文件：

- 修改 `src/views/Books.tsx`、选择保存服务和 IPC。
- 新增 location 状态转换和竞态测试。

测试与验收：

- 右键菜单、编辑器和划线保存不等待目录解析。
- 书籍切换、取消任务和重复选择不会把路径写到错误书籍或错误选区。

### AT-09 翻译、划线、批注三类独立保存流程

目标：让三类条目可独立创建、编辑、删除，并允许挂载到同一选区。

范围：

- 翻译结果作为 `translation` 保存，保留目标语言；不隐式创建划线。
- 划线即时保存，无正文要求；批注保存用户正文。
- 同一选区支持多个 note，默认限制同一语言一个当前 translation。
- 提供服务层 CRUD 和窄 IPC API。

预计文件：

- 新增 `src/components/ReaderSelectionEditor.tsx`。
- 修改 `src/views/Books.tsx` 和数据库服务/IPC。
- 新增 CRUD、校验和并发编辑测试。

测试与验收：

- 三类条目可分别编辑/删除，彼此不覆盖。
- 翻译正文、语言和批注正文的必填约束在 renderer 和主进程均生效。

### AT-10 PDF/OCR/EPUB 统一批注覆盖层

目标：将持久化条目映射回三种阅读来源的可视位置。

范围：

- 抽出 `PdfAnnotationLayer`，支持 PDF.js 原生文本层和 Tesseract 词框。
- EPUB 使用字符偏移/DOM 范围定位；缩放和布局变化时重新计算矩形。
- 划线显示底线，批注显示淡色填充和标记，翻译只在批注栏展示。
- 失效 Anchor 保留条目并显示可诊断状态。

预计文件：

- 新增 `src/components/PdfAnnotationLayer.tsx`。
- 修改 `src/components/PdfOcrTextLayer.tsx`、EPUB 阅读组件和样式。
- 新增跨页、缩放、OCR 和失效锚点测试。

测试与验收：

- 原生文本和 OCR 页面使用同一批注模型，覆盖层不改变页面尺寸。
- 重新打开和调整缩放后矩形仍可定位；无法定位时不产生空白遮罩。

### AT-11 多级目录抽屉、懒渲染与状态反馈

目标：提供可理解且不拖慢阅读器的任意深度目录交互。

范围：

- 递归 memoized 节点、独立展开状态、当前路径自动展开。
- 展开到当前章节、全部折叠、节点跳转和按书籍保存展开状态。
- 大树按展开分支懒渲染或虚拟列表。
- 展示缓存、分析中、部分完成、失败和重试状态，不遮挡阅读区域。

预计文件：

- 新增 `src/components/ReaderOutlineDrawer.tsx`。
- 修改阅读器布局和本地化资源。
- 新增树状态、跳转和大目录渲染测试。

测试与验收：

- 深层节点可展开、跳转和高亮；默认不会展开全部后代。
- 解析状态更新不重建 PDF `Document` 或重置滚动位置。

### AT-12 批注栏分类、颜色、跳转和虚拟列表

目标：让用户快速区分和管理翻译、划线、批注。

范围：

- 新增 `ReaderAnnotationsPanel`，提供全部/翻译/划线/批注筛选和计数。
- 使用图标、文字标签、边框/底线和语义颜色，不只依赖颜色。
- 条目展示原文、正文、完整章节路径、页码、时间和操作；点击跳转选区。
- 大量条目使用虚拟列表或分页，局部更新而非重绘阅读器。

预计文件：

- 新增 `src/components/ReaderAnnotationsPanel.tsx`。
- 修改样式、本地化和阅读器侧栏状态。
- 新增筛选、排序、跳转和键盘操作测试。

测试与验收：

- 三类条目在浅色/深色主题均有独立视觉和可访问名称。
- 筛选、删除和编辑只更新受影响条目；跳转跨页选择滚动到首段。

### AT-13 完整章节路径 Markdown/Notes 导出

目标：先交付章节正确、可重复同步的核心导出能力。

范围：

- 从数据库构建 UI 无关的 `ExportAnnotationRecord`，按章节层级、页码/y、创建时间排序。
- 使用完整 `chapterPath` 分组；无章节时使用“未识别章节”并保留页码。
- Markdown H1-H6 后使用完整路径加粗行/嵌套列表，不截断深层目录。
- Notes 生成区使用稳定 ID 标记，重复导出不重复，删除条目会消失但不改写用户手写区域。

预计文件：

- 完善 `src/services/readerAnnotationSerializer.ts`。
- 修改 `src/views/Books.tsx` 导出编排和 Notes 模块。
- 新增导出排序、重复同步、深度超过 H6 和跨章节测试。

测试与验收：

- 每条记录包含类型、原文、正文、完整路径、页码和深链接。
- 导出不再使用当前阅读章节冒充条目真实章节。

### AT-14 HTML/DOCX/PDF 导出适配和深链接

目标：复用统一导出模型扩展文件导出，保持类型样式和定位信息。

范围：

- HTML、DOCX、PDF 按任意深度目录生成真实层级。
- 翻译、划线、批注使用图标/颜色/文字标签表达，不依赖 Markdown 颜色。
- 增加 `book:{id}#annotation:{annotationId}` 深链接；兼容旧章节链接。
- 导出在后台执行，失败可重试且不清空已有 Notes。

预计文件：

- 修改 `src/services/readerAnnotationSerializer.ts`。
- 新增/修改 HTML、DOCX、PDF 导出适配器和深链接解析器。
- 新增输出结构和失败恢复测试。

测试与验收：

- 深层章节结构、三类样式、页码和深链接在各格式中可验证。
- 导出期间阅读器和批注栏仍可操作；失败消息包含可操作原因。

### AT-15 迁移、目录深度、性能和跨格式验收

目标：在交付前证明增强能力没有性能回退，且旧数据和异常 PDF 可继续使用。

范围：

- 覆盖普通文本、多栏、扫描、混合、无目录和损坏容错 PDF，以及 EPUB。
- 验证三级、五级和更深目录的父子关系、展开、当前路径和导出。
- 验证缓存命中/未命中、失败、取消、大文件、大批注列表和窗口调整。
- 核对迁移数量、旧链接、跨页选择、OCR、缩放重绘和重复导出。

预计文件：

- 新增/更新 `tests/readerAnnotation.integration.test.*`、性能脚本和样本说明。
- 必要时更新 `docs/archive/qa/` 中的验证记录。

测试与验收：

- `npm test`、`npm run lint`、`npm run build`、`git diff --check` 通过。
- 首屏、选择、滚动、翻页和窗口调整不等待或被目录解析阻塞。
- 失败路径保留 page-only/error 状态，用户仍可编辑和导出，不出现数据丢失。

## 四、推荐执行顺序

先完成 AT-01 至 AT-04，锁定性能和数据兼容边界；随后按 AT-05 至 AT-08 建立目录解析与异步定位；再按 AT-09 至 AT-12 接入三类交互；最后完成 AT-13、AT-14 导出和 AT-15 全量验收。AT-05 与 AT-06 的适配器实现可以并行准备，但只有 AT-05 的原生目录结果和 AT-06 的 fallback 契约都稳定后，才进入 AT-07 的统一索引。

## 五、交付记录模板

每个任务完成后在对应小节追加：

- 完成日期和提交号。
- 针对性测试命令及结果。
- 全量测试、lint、build 和 diff 检查结果。
- 未覆盖的风险或后续任务。
