# 周期任务统一模型迁移基线

状态：AT-01 已完成（2026-08-20）

本记录只做只读盘点，不修改用户数据库。

## 真实用户库统计

数据库：`C:/Users/Administrator/LifeOS/users/wdzwatson/database/tasks.db`

| 对象 | 数量 |
|---|---:|
| `tasks` | 51 |
| `recurring_rules` | 6 |
| `recurring_instances` | 16 |
| `recurring_rule_steps` | 0 |
| 周期根任务 | 16 |
| 日期级周期实例 | 16 |
| 时间执行项 | 32 |
| 孤立时间根任务 | 0 |
| 重复日期实例 | 0 |
| 重复时间执行项 | 0 |
| 错误继承 `instance_key` 的周期步骤 | 0 |

## 当前字段语义映射

| 当前形态 | 目标类型 |
|---|---|
| `recur_rule_id IS NULL` | `normal` |
| `recur_instance_root = 1`、`instance_key IS NULL`、`recurring_instance_id IS NOT NULL` | `recurring_date_instance` |
| `recur_instance_root = 0`、`instance_key IS NOT NULL`、父级为日期实例 | `recurring_execution` |
| 规则步骤生成的任务（若历史存在） | 周期步骤，不能作为普通子任务 |

## 已识别的维护风险

- 当前任务类型依赖多个字段组合判断，缺少显式类型字段。
- `parent_id` 同时承载普通父子关系和周期日期实例到执行项关系。
- 调度、主列表、便签需要统一使用任务类型判断，不能各自拼接条件。
- 周期步骤不能继承时间执行项的 `instance_key`，也不能进入普通任务统计。

## 迁移不变量

1. 同一 `(recur_rule_id, date_key)` 只能有一个日期实例。
2. 同一 `(recur_rule_id, recurring_instance_id, instance_key, parent_id)` 只能有一个时间执行项。
3. 日期实例 `instance_key` 必须为空；时间执行项 `instance_key` 必须为完整日期时间键。
4. 普通任务不得被周期调度器生成或修改。
5. 历史完成状态、标题和普通父子关系不得因类型迁移丢失。
