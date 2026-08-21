# C-01-06 全局搜索验收与指标

日期：2026-08-20  
状态：已完成，已归档
所属计划：[C-01 全局搜索原子任务计划](2026-08-20-c01-global-search-atomic-tasks.md)

## 目标

建立可以独立执行的搜索验收矩阵，并定义后续产品指标，避免只以“弹层能打开”判断完成。

## 验收范围

- 四类对象：任务、笔记、书籍、视频。
- 状态：空闲、加载、成功、无结果、部分失败、完全失败。
- 操作：鼠标、键盘、Esc、`/task`、`/note`。
- 环境：中文、English、桌面默认窗口、390px 窄窗口。
- 安全：锁定私密笔记、无效对象 ID。

## 实现步骤

1. 建立用例表，字段包含前置数据、步骤、预期、实际结果、证据和缺陷等级。
2. 增加搜索逻辑和交互自动化测试。
3. 执行 `npm test`、`npm run build`、`npm run lint`。
4. 使用本地页面完成桌面和窄窗口交互验收并保留截图/DOM 证据。
5. 记录指标字段：query_started、first_result、result_clicked、query_empty、query_failed、module、duration_ms。

## 验收标准

- 产品方案中的全部 P1 标准均有通过或延期决定。
- 每个失败项有复现路径、影响等级和负责人。
- 指标能区分搜索开始、首个结果、点击和失败。
- 不把未执行的 CodeRabbit 或其他工具结果作为验收证据。

## 输出物

- 自动化测试结果。
- 人工验收记录与截图。
- 指标字段说明。
- 已知限制和后续产品决策。

## 验收矩阵

| 用例 | 覆盖方式 | 结果 |
|---|---|---|
| 任务、笔记、书籍、视频 | 统一结果模型、模块分组和 deep-link 事件测试 | 通过 |
| 加载、空结果、部分失败、完全失败 | 查询状态模型与 request ID 保护；Electron/Node 测试 | 通过 |
| 鼠标、Arrow/Home/End、Enter、Esc | `combobox/listbox/option` 契约与键盘导航测试 | 通过 |
| `/task`、`/note`、中文、English | 命令分支、双语资源和排序测试 | 通过 |
| 390px 与桌面 | 响应式 CSS、稳定 aria-label；浏览器冒烟记录 | 通过，仍需不同系统字体复核 |
| 私密笔记、无效 ID | 私密安全 SQL/FTS 测试；模块 not-found 文案 | 通过 |

## 指标契约

指标仅写入当前浏览器会话的 `sessionStorage`，最多保留 100 条；不上传、不写数据库。允许字段为：

- `event`: `query_started`、`first_result`、`result_clicked`、`query_empty`、`query_failed`。
- `module`: `command`、`tasks`、`notes`、`books`、`videos`（仅结果/点击相关事件需要）。
- `duration_ms`: 本地耗时整数。
- `timestamp`: ISO 时间戳。

明确禁止记录 query 文本、实体标题、摘要、实体 ID、错误原文和任何私密内容。

## 完成证据

- `node --import tsx --test tests/globalSearch.test.ts`：8 项通过。
- `electron --import tsx --test tests/notesFtsPrivacy.test.ts`：3 项通过。
- `npm test`、`npm run lint`、`npm run build` 通过。
- 浏览器冒烟覆盖搜索打开、结果列表语义、Esc 关闭和 390px 入口名称；未执行 CodeRabbit，不将其作为验收证据。
