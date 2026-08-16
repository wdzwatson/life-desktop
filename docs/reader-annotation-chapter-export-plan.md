# PDF/EPUB 章节感知批注与导出方案

状态：待审核

## 1. 目标

将阅读器中的选中文本统一建模为一个“选区”，并在选区上挂载三类独立条目：

1. 翻译：保存原文、目标语言和翻译结果。
2. 划线：保存原文位置，不要求附加文字。
3. 批注：保存原文位置和用户写下的笔记。

三类条目需要同时满足：

- 能准确记录所在章节、小节和页码。
- 在阅读器页面和右侧批注栏中有明确的类型差异。
- 可以单独编辑、删除、筛选和导出。
- 同一段原文可以同时拥有翻译、划线和批注。
- PDF、EPUB、原生文本层和 OCR 文本层使用同一套持久化模型。
- 重新解析目录或调整阅读器布局后，历史批注仍可定位或降级到可审核状态。

## 2. 当前实现与缺口

当前 `books` 数据库的 `highlights` 表只有 `text`、`annotation` 和 JSON `anchor` 字段。翻译结果目前保存在 React 状态中，只有用户点击“用作批注”后才可能进入 `annotation`，因此无法区分翻译和普通批注。

PDF 原生文本选择目前通过 PDF.js 文本层的 `Range.getClientRects()` 产生归一化矩形；OCR 页面则通过 Tesseract 词框产生归一化矩形。这部分适合作为交互层，应继续保留。

当前导出逻辑还有两个问题：

- 所有导出条目都使用当前阅读章节，而不是每一条记录真实所在的章节。
- 导出只有“原文 + 批注”的概念，不能稳定表达翻译和划线。

相关代码位置：

- 选择与 PDF 坐标锚点：[src/views/Books.tsx](../src/views/Books.tsx:1666)
- 写入现有 `highlights`：[src/views/Books.tsx](../src/views/Books.tsx:2498)
- PDF/OCR 高亮覆盖层：[src/components/PdfOcrTextLayer.tsx](../src/components/PdfOcrTextLayer.tsx:257)
- 现有导出：[src/views/Books.tsx](../src/views/Books.tsx:2687)
- 数据库表结构：[electron/db/schema.ts](../electron/db/schema.ts:567)

## 3. 总体架构

```mermaid
flowchart TD
  A[用户选择文本] --> B{文本来源}
  B -->|PDF.js 文本层| C[Range + 页面矩形]
  B -->|OCR 文本层| D[Tesseract 词框 + 页面矩形]
  B -->|EPUB DOM| E[章节/段落/字符偏移]
  C --> F[统一 Selection Anchor]
  D --> F
  E --> F
  F --> G[解析章节树并定位章节/小节]
  G --> H[保存 Reader Selection]
  H --> I{创建条目}
  I --> J[Translation]
  I --> K[Underline]
  I --> L[Note]
  J --> M[批注栏 / 阅读器覆盖层 / 导出]
  K --> M
  L --> M
```

核心原则：

- PDF.js/Tesseract 负责“用户看到的坐标和交互”。
- 章节服务负责“这段文字属于哪一个章节和小节”。
- 数据库负责“选区与三类条目的长期保存”。
- 导出服务只消费规范化数据，不直接读取 React 状态。
- `pdf-inspector` 只用于目录和文本结构分析，不替代 PDF.js 渲染和批注覆盖层。

## 4. 章节树设计

### 4.1 章节来源优先级

对 PDF 使用以下优先级：

1. PDF.js `PDFDocumentProxy.getOutline()`：PDF 自带书签，最可靠。
2. `pdf-inspector.extractStructureElements()` + `extractTextWithPositions()`：Tagged PDF 的 H1-H6、TOC/TOCI 等结构。
3. `pdf-inspector.extractPagesMarkdownAsync()`：无书签、无结构标签时，根据字体大小、粗体、布局和标题模式推断。
4. 仅保存页码和“未识别章节”：不要为了生成漂亮标题而伪造低置信度章节。

EPUB 继续使用现有 EPUB TOC 和章节/段落偏移，不需要经过 PDF 章节解析流程。

### 4.2 章节缓存表

新增 `book_outline_nodes` 表，建议字段如下：

```sql
CREATE TABLE IF NOT EXISTS book_outline_nodes (
  id TEXT PRIMARY KEY,
  book_id INTEGER NOT NULL,
  parent_id TEXT,
  source TEXT NOT NULL CHECK(source IN ('pdf-outline', 'pdf-tagged', 'pdf-inferred', 'epub-toc')),
  level INTEGER NOT NULL,
  title TEXT NOT NULL,
  page_start INTEGER,
  y_start REAL,
  page_end INTEGER,
  y_end REAL,
  confidence REAL,
  sort_order INTEGER NOT NULL,
  locator_json TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES book_outline_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS book_outline_nodes_book_order_idx
  ON book_outline_nodes(book_id, sort_order);
```

`locator_json` 保存来源特有的跳转信息：

- PDF.js outline：destination、page index、视图参数。
- Tagged PDF：page、MCID、PDF 点坐标。
- 推断标题：page、PDF 点坐标、标题文本匹配信息。
- EPUB TOC：chapter index、href、paragraph offset。

章节解析结果需要按文件内容哈希和解析器版本缓存。打开阅读器时先显示第一页，章节解析在后台执行；解析完成后再刷新目录，不阻塞首屏。

### 4.3 章节定位算法

对一个选区，统一得到文档位置 `DocumentPosition`：

```ts
type DocumentPosition = {
  format: 'pdf' | 'epub'
  pageNumber?: number
  y?: number
  chapterIndex?: number
  blockOffset?: number
  charOffset?: number
}
```

PDF 定位使用 `(pageNumber, y)`，选择拥有最大 `page_start/y_start` 且不晚于选区起点的章节节点；优先选择最深层级节点。EPUB 使用现有 `(chapterIndex, blockOffset)` 精确匹配。

最终保存两份信息：

1. `outline_node_id`：便于未来重新解析目录后修正关联。
2. `outline_snapshot`：保存创建批注时的章节标题和完整层级，保证导出不会因目录变化而失去上下文。

如果选区跨越多个章节，使用起始章节作为主章节，同时记录 `end_outline_snapshot`；导出时在条目上标记“跨章节”，不强行拆分原文。

## 5. 统一数据模型

建议新增“选区”和“条目”两层，而不是继续把三种含义塞进 `highlights.annotation`。

### 5.1 `reader_selections`

一个选区代表一段原文和它在文档中的位置。

```sql
CREATE TABLE IF NOT EXISTS reader_selections (
  id TEXT PRIMARY KEY,
  book_id INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('pdf', 'epub')),
  anchor_version INTEGER NOT NULL DEFAULT 2,
  anchor_json TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  outline_node_id TEXT,
  outline_snapshot_json TEXT NOT NULL,
  source_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (outline_node_id) REFERENCES book_outline_nodes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS reader_selections_book_order_idx
  ON reader_selections(book_id, created_at);
```

### 5.2 `reader_annotation_items`

一个选区可挂多个条目，例如同一段原文同时有划线、中文翻译和个人批注。

```sql
CREATE TABLE IF NOT EXISTS reader_annotation_items (
  id TEXT PRIMARY KEY,
  selection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('translation', 'underline', 'note')),
  body TEXT,
  target_language TEXT,
  style_token TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (selection_id) REFERENCES reader_selections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reader_annotation_items_selection_kind_idx
  ON reader_annotation_items(selection_id, kind);
```

约束建议：

- `underline` 的 `body` 为空。
- `translation` 的 `body` 必填，`target_language` 必填。
- `note` 的 `body` 必填，`target_language` 为空。
- 同一个 `selection_id` 可以有多个 `note`，但默认只允许一个当前语言的 `translation`。
- `style_token` 只存语义值，例如 `translation`、`underline`、`note`，不直接存颜色值。

### 5.3 Anchor v2

现有 PDF anchor 只保存一个 `pageNumber` 和 `areas`，跨页选择会丢失后续页面。建议升级为：

```ts
type ReaderAnchorV2 = {
  version: 2
  format: 'pdf' | 'epub'
  pdf?: {
    segments: Array<{
      pageNumber: number
      areas: Array<{ x: number; y: number; width: number; height: number }>
      pdfPoints?: Array<[number, number, number, number]>
    }>
    start?: { pageNumber: number; x: number; y: number }
    end?: { pageNumber: number; x: number; y: number }
  }
  epub?: {
    chapterIndex: number
    blockOffset: number
    startOffset: number
    endOffset: number
  }
  quote: {
    exact: string
    prefix?: string
    suffix?: string
  }
}
```

`pdfPoints` 是可选冗余定位信息，用于窗口尺寸变化或文本层变化后的重定位；当前显示仍以归一化 DOM 矩形为准。

## 6. 三类批注交互与视觉设计

### 6.1 创建流程

用户选择文本后，右侧编辑区显示三个明确动作：

- 翻译：调用现有翻译服务，结果作为 `translation` 条目保存。
- 划线：立即保存 `underline` 条目，不要求用户输入文字。
- 批注：打开文本输入框，保存 `note` 条目。

翻译结果不再自动塞入批注文本。可以提供“复制到批注”作为显式动作，但它会创建一个独立的 `note`，并保留原始翻译条目。

同一选区的三个条目应独立编辑和删除，不能通过 `highlighted = false` 推断类型。

### 6.2 颜色和样式

颜色不能是唯一的区分方式，需同时使用图标、文字标签、边框和布局。

建议语义 token：

| 类型 | 图标建议 | 浅色主题 | 深色主题 | 阅读器覆盖层 |
|---|---|---|---|---|
| 翻译 | Languages | 蓝色文字/浅蓝背景 | 亮蓝/深蓝背景 | 翻译结果不覆盖原文，显示在批注栏 |
| 划线 | Underline | 琥珀色底线 | 亮琥珀色底线 | 原文矩形仅显示底线 |
| 批注 | MessageSquare | 绿色左边框/浅绿背景 | 亮绿色左边框 | 原文矩形显示淡色填充和批注标记 |

建议批注栏使用分段筛选：`全部`、`翻译`、`划线`、`批注`，每个标签显示数量。默认按文档顺序排序，辅助按创建时间排序。

每个条目至少显示：类型标签、原文、章节/小节、页码、正文内容、创建时间和操作按钮。批注栏中的类型卡片点击后跳转到对应选区；跨页选区滚动到第一段。

## 7. 导出设计

### 7.1 统一导出模型

先由数据库生成与 UI 无关的导出模型：

```ts
type ExportAnnotationRecord = {
  id: string
  kind: 'translation' | 'underline' | 'note'
  sourceText: string
  body?: string
  targetLanguage?: string
  chapterPath: string[]
  pageNumber?: number
  documentOrder: number
  deepLink: string
}
```

排序顺序：章节层级 -> 页码/EPUB 段落 -> 页面 y 坐标 -> 创建时间。

章节或页码无法识别时，归入“未识别章节”，并保留页码，不丢弃条目。

### 7.2 Markdown 导出格式

建议输出如下：

```markdown
# 书名

## 第一章 章节标题

### 1.1 小节标题

#### 翻译

> Original text

翻译：翻译结果

来源：第 12 页 · 第一章 / 1.1 小节

#### 划线

> Important sentence

来源：第 13 页 · 第一章 / 1.1 小节

#### 批注

> Another sentence

批注：我的理解和问题

来源：第 14 页 · 第一章 / 1.1 小节
```

Markdown 不依赖颜色表达类型，使用标题和文字标签；HTML、DOCX 和 PDF 导出可以在此基础上增加颜色和图标。

### 7.3 增量同步

当前导出会按标题覆盖整篇 Note，并且使用当前章节。建议改成：

- 由数据库完整重建“生成区域”，保证删除和编辑都能反映到导出文档。
- 在 Note 中使用不可见标记保存生成区域边界，例如 `lifeos:reader-annotations`。
- 不修改生成区域之外的用户手写内容。
- 每个条目带稳定 ID，重复导出不会产生重复条目。

第一阶段建议只实现 Markdown/Notes 导出，复用现有 Notes 模块；第二阶段再增加独立 `.md`、`.html`、`.docx` 和 `.pdf` 文件导出。

## 8. 迁移策略

采用增量迁移，不立即删除现有 `highlights` 表。

### 8.1 旧数据映射

每一条旧 `highlights` 先创建一个 `reader_selections`：

- `source_text` <- `highlights.text`
- `anchor_json` <- 旧 `anchor`，转换为 Anchor v2
- `outline_snapshot_json` <- 根据页码/章节重新解析，失败时写入“未识别章节”

再按旧数据拆分条目：

- `anchor.highlighted !== false` -> `underline`
- 非空 `annotation` -> `note`
- 无法判断是否原本是翻译的旧 annotation，默认迁移为 `note`，不猜测其类型。

迁移完成后保留旧表一段时间，采用双读或只读兼容，确认数据量一致后再移除旧代码路径。

### 8.2 兼容旧链接

当前 `book:{id}#chapter` 深链接继续可用；新增 `book:{id}#annotation:{annotationId}`。如果旧链接只有章节名，则打开章节首个可定位节点。

## 9. 代码落点

建议拆出服务和组件，避免继续扩大 `Books.tsx`：

```text
src/types/readerAnnotation.ts
src/services/readerAnnotationSerializer.ts
src/components/ReaderAnnotationsPanel.tsx
src/components/PdfAnnotationLayer.tsx
src/components/ReaderSelectionEditor.tsx
electron/readerOutlineService.ts
electron/readerAnnotationMigration.ts
electron/worker/pdfInspectorWorker.ts
```

主要职责：

- `readerAnnotation.ts`：共享类型、Anchor v2、三类条目。
- `readerOutlineService.ts`：PDF.js outline、pdf-inspector fallback、章节缓存。
- `pdfInspectorWorker.ts`：执行同步的结构/位置 API，避免阻塞 Electron 主进程。
- `PdfAnnotationLayer.tsx`：只负责 PDF/OCR 归一化矩形的显示，不负责数据库。
- `ReaderAnnotationsPanel.tsx`：筛选、编辑、删除、跳转和导出入口。
- `readerAnnotationSerializer.ts`：Markdown/HTML/DOCX/PDF 的公共排序和分组逻辑。
- `Books.tsx`：只保留阅读器生命周期和回调编排。

`pdf-inspector` 不应直接打进 React renderer。Node N-API 版本应放在 Electron 主进程或 Worker 中，通过窄 IPC 接口返回章节结果和定位数据。

## 10. 分阶段实施

### Phase 1：数据模型和迁移

- 新增两张表和索引。
- 定义共享 TypeScript 类型。
- 实现旧 `highlights` 到新模型的幂等迁移。
- 实现统一查询和保存 API。
- 添加迁移数量、空字段和旧 anchor 兼容测试。

### Phase 2：章节定位

- PDF.js 加载成功后读取原生 outline。
- 无 outline 时后台运行 `pdf-inspector`。
- 保存章节树缓存和解析版本。
- 给每个新选区写入章节/小节快照。
- 对无法定位的条目标记 `confidence` 和“未识别章节”。

### Phase 3：三类交互

- 把翻译从临时 React 状态变成独立条目。
- 增加“翻译 / 划线 / 批注”三个创建动作。
- 将当前 PDF/OCR 覆盖层改为读取 `reader_annotation_items`。
- 批注栏增加类型筛选、数量、颜色、图标和跳转。
- 保存跨页 Anchor v2。

### Phase 4：导出

- 先实现章节分组的 Markdown/Notes 导出。
- 修复每条记录使用自身章节，而不是当前章节。
- 加入稳定 ID、深链接、类型标签和页码。
- 再复用公共导出模型实现 HTML/DOCX/PDF。

### Phase 5：质量和性能

- 建立普通文本、多栏、扫描、混合、无目录和损坏容错 PDF 样本集。
- 验证章节定位、跨页选择、缩放重绘、OCR 选择和导出顺序。
- 首屏不等待目录解析。
- 结构/坐标解析放 Worker，主线程不被大 PDF 阻塞。

## 11. 验收标准

- 同一选区可以同时拥有翻译、划线和批注，彼此独立编辑和删除。
- 批注栏可以只查看一种类型，并且不依赖颜色才能识别类型。
- 每条导出记录包含原文、类型正文、章节路径、页码和深链接。
- 原生 PDF 书签跳转优先使用 PDF.js，不被启发式标题覆盖。
- 没有目录的 PDF 不产生虚假章节，至少保留页码和“未识别章节”。
- PDF 缩放、布局切换和重新打开后，已保存矩形仍能正确显示。
- OCR 页面与原生文本页面共用相同的批注栏和导出格式。
- 重复导出不会重复添加条目，删除条目会从生成区域消失。
- 迁移前后的条目数量可核对，旧数据不因无法识别类型而丢失。
- 大 PDF 的章节分析不阻塞第一页渲染和用户选择。

## 12. 需要审核的决策

1. 是否采用“选区 + 条目”两层模型，而不是在现有 `highlights` 表增加 `kind` 字段？推荐两层模型，因为同一段原文同时拥有三类条目时不会重复保存位置。
2. 翻译是否默认自动创建划线？推荐不自动创建，翻译、划线和批注保持独立，由用户明确选择。
3. 是否允许用户自定义三类颜色？第一阶段推荐固定语义颜色，后续再支持主题级调整。
4. 第一阶段导出是否只做 Notes Markdown？推荐是，先保证章节分组和数据正确，再增加 DOCX/PDF 样式导出。
5. 是否允许用户手动修正“未识别章节”？推荐增加“修改章节归属”入口，修正结果写入快照，不修改 PDF 原文。
