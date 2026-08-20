# 周期任务与普通父子任务统一模型方案

状态：已归档（2026-08-20；最终审核版）

配套原子任务：`docs/archive/project-plans/2026-08-20-recurring-task-unified-atomic-tasks.md`

## 1. 目标

统一支持两类业务，同时避免把它们都称为“子任务”：

1. 周期执行任务：例如每天 09:00、23:59 刷牙，实际执行的是每个日期和时间组合产生的执行项。
2. 普通父子任务：例如“健身计划 → 买运动鞋”，父任务和子任务都是独立任务，只存在用户手动建立的层级关系。

产品原则：主面板展示任务结构；其它页签和桌面便签展示可执行事项。

## 2. 对象模型

```text
普通任务
├── 普通父任务
└── 普通子任务

周期规则
└── 日期实例（某一天的周期容器）
    ├── 时间执行项（某天某个时间）
    ├── 时间执行项
    └── 时间执行项
```

周期规则按以下矩阵生成：

```text
符合规则的日期 × 当天执行时间
```

因此：

- 单日多次 = 1 个日期实例 × N 个执行项；
- 多日多次 = M 个日期实例 × N 个执行项；
- 例如 3 天、每天 3 次 = 3 个日期实例、9 个时间执行项。

日期实例是汇总容器，不是独立可执行事项。时间执行项才是周期任务的可执行对象。

## 3. 类型与关系边界

推荐增加明确的 `task_kind` 和 `relation_kind`，禁止通过 `parent_id`、`recur_rule_id`、`instance_key` 的组合在页面中猜测语义。

```text
task_kind:
- normal
- recurring_date_instance
- recurring_execution

relation_kind:
- root
- manual_child
- recurring_occurrence
```

字段规则：

| 类型 | `task_kind` | `relation_kind` | `parent_id` | `instance_key` | 规则来源 |
|---|---|---|---|---|---|
| 普通根任务 | `normal` | `root` | 空 | 空 | 空 |
| 普通子任务 | `normal` | `manual_child` | 普通任务 | 空 | 空 |
| 日期实例 | `recurring_date_instance` | `root` 或明确的周期挂靠关系 | 可选 | 空 | 必填 |
| 时间执行项 | `recurring_execution` | `recurring_occurrence` | 日期实例 | `YYYY-MM-DDTHH:mm` | 必填 |

业务边界：自动生成、绑定周期规则、属于某个日期和执行时间的对象是周期执行项；用户手动挂靠、标题可以不同、生命周期独立的对象是普通父子任务。

普通任务默认不得挂到周期日期实例下。未来若需要周期任务下的人工备注，应新增独立关系类型，不复用 `manual_child`。

## 4. 页面展示

### 4.1 主面板任务实例列表

主面板展示结构，但使用不同文案区分两种关系：

```text
2026-08-20 服药
  当日 3 次
    09:00 服药
    13:00 服药
    21:00 服药

健身计划
  子任务 1/1
    买运动鞋
```

- 周期日期实例只出现一次；时间项通过“当日 N 次”展开；时间项可单独完成、打开详情、修改或跳过。
- 普通父子任务继续使用“子任务”统计和普通任务树。
- 时间执行项不得计入普通子任务数量。

### 4.2 其它页签和桌面便签

统一使用 `getActionableTasks` 过滤：

- 隐藏 `recurring_date_instance`；
- 显示 `recurring_execution`；
- 显示普通父任务和普通子任务；
- 周期内部步骤默认隐藏。

这样周期任务显示为 `09:00 服药`、`13:00 服药`，普通任务显示为 `健身计划`、`买运动鞋`。

## 5. 周期步骤

周期步骤与普通子任务不是同一种对象。推荐最终拆为 `task_execution_steps`，字段包括：

```text
id, execution_task_id, rule_step_id, title, status, is_completed, sort_order
```

步骤只在时间执行项详情或主面板内部展示，默认不进入其它页签和桌面便签，也不参与普通父子任务统计。迁移完成前，若继续使用 `tasks` 表，必须显式标记步骤类型并统一过滤；步骤不得继承时间执行项的 `instance_key`。

## 6. 状态与操作范围

### 周期任务

- 每个时间执行项独立完成，完成一个时间项不得改变同日其它时间项或其它日期项；
- 日期实例按当天执行项汇总 `0/N`、`1/N`、`N/N` 状态；
- 修改、删除、跳过某次执行只作用于完整 occurrence key，例如 `2026-08-20T13:00`；
- 修改未来规则才影响未来日期；历史已完成项不被重写；
- 删除整个周期规则才删除规则及其全部日期实例。

### 普通父子任务

- 父任务和子任务独立显示、独立编辑；
- 完成子任务只更新普通父任务进度；
- 删除范围遵循普通任务树规则，不进入周期规则例外机制。

## 7. 数据完整性与迁移

数据库约束：

- `recurring_instances` 唯一 `(recur_rule_id, date_key)`；
- 时间执行项唯一 `(recur_rule_id, recurring_instance_id, instance_key, parent_id)`；
- 日期实例 `instance_key IS NULL`；
- 时间执行项 `instance_key IS NOT NULL` 且父级必须是日期实例；
- 普通任务 `generated_by_rule_id IS NULL`。

启动迁移顺序：

1. 临时删除旧唯一索引；
2. 合并同一规则同一天的重复日期实例；
3. 归并孤立时间根任务到日期实例；
4. 合并重复时间执行项并迁移后代；
5. 清理周期步骤错误继承的 `instance_key`；
6. 校验普通父子关系不混入周期关系；
7. 创建新唯一索引；
8. 迁移必须幂等、可重复执行且不改写已完成历史状态。

## 8. 开发规范

提供并复用以下判断和查询函数：

```ts
isNormalTask(task)
isRecurringDateInstance(task)
isRecurringExecution(task)
isManualChildTask(task)
isRecurringStep(task)
isActionableTask(task)
getActionableTasks(tasks)
getRecurringDateInstances(tasks)
getRecurringExecutionsForDate(tasks, dateKey)
getManualChildren(tasks, parentId)
```

页面不得直接拼接多字段条件判断任务语义。调度器、主列表、其它页签和便签必须使用同一套类型判断。

## 9. 验收标准

- 单日两次只显示一个日期实例和两个时间执行项；
- 多日多次按日期实例 × 执行时间生成且不重复；
- 重启不重复生成；
- 日期实例不出现在其它页签和桌面便签；
- 周期时间项出现在其它页签和桌面便签；
- 普通父任务和普通子任务都出现在其它页签和桌面便签；
- 周期步骤默认不出现在便签；
- 完成一个时间项不影响其它时间项；
- 普通父子关系不被识别为周期执行关系；
- 历史旧数据启动后完成归并并建立约束；
- 同一规则、日期、时间的重复执行项无法再次插入。
