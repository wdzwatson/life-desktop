# 扫描版 PDF 阅读器性能验收

日期：2026-08-26
状态：通过
范围：PDF-PERF-01 至 PDF-PERF-06
分支：`performance`

## 1. 验收结论

本轮不实施真正虚拟化。320 页完整占位列表的目录定位 P95 为 0.10 ms，占 16 ms 帧预算 0.625%，占最轻冷页面阶段 2.00%；宽度重排 P95 为 1.80 ms，占一帧 11.25%。三项预设决策阈值均未触发，当前主要成本仍在 PDF 页面解析、operator list、canvas 绘制和文本层，而不是轻量占位 DOM。

已交付的优化包括：会话内性能 trace、文本层结果复用、页面元数据局部订阅、目标页优先且最多 2 个在途页面的调度器，以及 96 MiB 像素预算 LRU。没有重新引入“只渲染目标页，再一次性恢复邻页”的两阶段模式。

## 2. 环境与方法

- 系统：Windows，x64，Asia/Shanghai。
- Node.js：仓库声明的 Node 24 系列运行时。
- PDF.js：项目锁定版本，通过 `pdfjs-dist/legacy/build/pdf.mjs` 运行。
- DOM：Codex 应用内 Chromium，320 个与连续阅读占位结构等价的固定尺寸节点，40 轮采样。
- PDF 固定样本：纯扫描、隐藏 OCR、普通文本和混合 PDF，均归档在 `docs/archive/qa/assets/reader-at15/`。
- PDF 页面阶段使用 `getPage()` 加 `getOperatorList()`；它不包含最终 canvas 栅格化，因此是重页面阶段的保守下界。实际 canvas 成本只会进一步降低 DOM 成本占比。

## 3. 固定样本

| 样本 | 页数 | 冷页面阶段 ms | 热页面阶段 ms | 连续页面均值 ms | `getTextContent()` ms | 文本项 |
|---|---:|---:|---:|---:|---:|---:|
| 纯扫描 | 1 | 56.771 | 0.027 | 0.085 | 2.398 | 0 |
| 隐藏 OCR | 1 | 6.127 | 0.023 | 0.021 | 4.156 | 2 |
| 普通文本 | 8 | 7.295 | 0.020 | 3.451 | 10.468 | 64 |
| 混合 PDF 扫描页 | 2 | 4.991 | 0.013 | 1.093 | 0.521 | 0 |

测量命令：

```text
npm run benchmark:pdf-reader
```

结论：`getTextContent()` 在普通文本页上可达到 10.468 ms，确实不是零成本；PDF-PERF-02 已删除页面类型判断的重复调用，只复用 react-pdf 文本层结果。扫描页在模式已知后的重挂载会关闭文本层。

## 4. DOM 结构基准

| 指标 | 结果 ms |
|---|---:|
| 320 页冷创建 P50 | 2.20 |
| 320 页冷创建 P95 | 3.70 |
| 目录目标定位 P95 | 0.10 |
| 连续五次目标定位单次 P95 | 0.02 |
| 320 页宽度调整和强制布局 P95 | 1.80 |

基准页面：`scripts/pdf-reader-dom-benchmark.html`。页面使用连续 flex 列、24 px 间距、固定宽高页槽、`data-page-number` 定位、`offsetTop` 和 `scrollHeight` 强制布局，覆盖当前实现中与虚拟化决策直接相关的结构成本。

## 5. 虚拟化决策

决策阈值：

- 目录跳转结构 P95 达到帧预算 25%；或
- 目录跳转结构 P95 达到最轻冷页面阶段 20%；或
- 宽度重排 P95 达到完整 16 ms 帧预算。

实测比例：

| 比例 | 实测 | 阈值 | 结果 |
|---|---:|---:|---|
| 目录定位 / 帧预算 | 0.625% | 25% | 未触发 |
| 目录定位 / 最轻冷页面阶段 | 2.004% | 20% | 未触发 |
| 宽度重排 / 帧预算 | 11.25% | 100% | 未触发 |

纯函数 `scripts/pdf-reader-virtualization-decision.mjs` 返回 `implementVirtualization: false` 且 `reasons: []`。因此保留完整轻量页槽，不增加有限窗口、上下 spacer、累计高度索引以及目录/滚动同步的额外状态复杂度。

## 6. 功能与性能回归

- 目录定位：目标页为远跳后第一个新准入页面，旧跳转 trace 会失效。
- 并发：任意相邻或远距离窗口变化，同时在途页面不超过 2。
- 热往返：预算内完成页保持挂载，返回时不重新进入在途队列。
- 内存：canvas 按 RGBA 像素字节估算，非保护页按 LRU 淘汰；会话、宽度和 DPR 变化整体失效。
- 滚动与自动阅读：手动 `currentPageIndex` 和自动阅读 `renderWindowCenter` 共用同一调度模型。
- OCR 与批注：OCR 加载页、手写选择页和活动批注页受缓存保护；OCR 仍按需触发。
- 视图：单页、双页和单页连续模式保留；默认阅读视图仍为单页连续。
- 隐私：trace、调度器和缓存不记录书名、路径、目录标题、选中文本或 OCR 内容，不写数据库和外部遥测。

## 7. 验证命令

```text
npm run benchmark:pdf-reader
npx tsx --test tests/pdfReaderVirtualizationDecision.test.mjs tests/pdfReaderPerformanceBenchmark.test.mjs tests/pdfPageRenderScheduler.test.ts tests/pdfPageRenderCache.test.ts tests/pdfReaderPerformance.test.ts tests/pdfPageTextMode.test.ts tests/pdfPageMetadataCache.test.ts tests/readerPdfFixtures.test.ts tests/bookReaderPresentation.test.ts
npm test
npm run lint
npx tsc -b --pretty false
npm run build
git diff --check
```

结果：全部通过。

## 8. 遗留风险

- DOM 基准隔离了占位列表结构，没有模拟完整 React 提交、浏览器绘制和真实用户机器差异；若生产 trace 显示超长文档的结构阶段持续超过阈值，应重新执行虚拟化决策。
- `getOperatorList()` 不等同最终 canvas 绘制，文档中的比例是有利于虚拟化的保守比较，而不是端到端视觉完成时间。
- LRU 只估算 canvas RGBA 像素，不包含 PDF.js 内部解码对象和浏览器图层开销；保护页可能短暂超预算，保护解除后会立即回收。
- 当前 fixture 最大真实 PDF 为 8 页，320 页使用结构合成样本；后续若获得可公开归档的超长扫描 PDF，应补充真实设备冷跳和内存峰值记录。
