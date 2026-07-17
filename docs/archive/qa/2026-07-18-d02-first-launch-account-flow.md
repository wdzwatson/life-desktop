# D-02 首次启动与账户流程验收

日期：2026-07-18
任务：D-02
状态：已完成
目标版本：LifeOS 1.0.2
执行包：`dist_electron/mac/LifeOS.app`
验收方式：打包应用 + Playwright 连接 Electron DevTools Protocol + 文件级核验

## 1. 验收目标

验证 macOS 打包应用在干净数据目录下的首次启动、账户创建、密码登录、错误密码拦截、退出登录、账户切换和重启保留行为。

## 2. 数据保护

- 执行前确认没有残留 LifeOS 进程。
- 将真实数据目录 `/Users/mac/LifeOS` 临时移动到 `/Users/mac/LifeOS.codex-d02-backup-20260718-001`。
- 使用打包应用重新生成干净的 `/Users/mac/LifeOS` 执行验收。
- 验收完成后将临时验收数据移动到 `/tmp/LifeOS.codex-d02-evidence-20260718-001`。
- 已将原始 `/Users/mac/LifeOS` 恢复到原路径。

## 3. 验收记录

| ID | 场景 | 实际结果 | 状态 |
|---|---|---|---|
| D02-01 | 干净首次启动 | 应用正常打开，自动生成 `guest` 用户，仪表盘为空数据状态，状态栏显示 `SQLite · Local (guest)` | 通过 |
| D02-02 | 创建受密码保护账户 | 创建 `d02user`，昵称 `D02 用户`，头像 `D`，设置密码、密码提示和密保答案后进入工作台 | 通过 |
| D02-03 | 密码存储 | `settings.json` 中 `d02user` 存在 `passwordHash` 和 `salt`，不存在明文 `password` 字段 | 通过 |
| D02-04 | 错误密码 | 退出登录后选择 `D02 用户`，输入错误密码，界面显示 `密码错误`，仍停留在解锁页 | 通过 |
| D02-05 | 正确密码 | 输入正确密码后进入 `d02user` 工作台，状态栏显示 `SQLite · Local (d02user)` | 通过 |
| D02-06 | 切换到访客账户 | 退出登录，选择 `访客模式`，点击进入后状态栏显示 `SQLite · Local (guest)` | 通过 |
| D02-07 | 切回受保护账户 | 再次退出登录，选择 `D02 用户` 并输入正确密码，恢复到 `d02user` 工作台 | 通过 |
| D02-08 | 重启保留 | 完全退出应用并重新启动，自动恢复到 `d02user` 工作台，账户状态保留 | 通过 |
| D02-09 | 用户目录与数据库 | `guest` 和 `d02user` 均生成独立 `database` 与 `files` 目录；`d02user` 下生成 `tasks.db`、`notes.db`、`books.db`、`videos.db`、`vault.db` | 通过 |

## 4. 证据摘要

重启后首屏包含：

```text
SQLite · Local (d02user)
D02 用户
Ready · DASHBOARD · 离线模式 (d02user)
```

配置文件核验摘要：

```json
{
  "lastUserId": "d02user",
  "users": ["guest", "d02user"],
  "d02HasHash": true,
  "d02HasPlainPassword": false
}
```

用户目录核验摘要：

```text
/Users/mac/LifeOS/users/d02user/database/books.db
/Users/mac/LifeOS/users/d02user/database/notes.db
/Users/mac/LifeOS/users/d02user/database/tasks.db
/Users/mac/LifeOS/users/d02user/database/vault.db
/Users/mac/LifeOS/users/d02user/database/videos.db
```

## 5. 发现的问题与风险

### 5.1 测试隔离风险

打包应用当前通过 `app.getPath('home')` 固定使用当前系统用户主目录下的 `LifeOS`，无法通过 `HOME=/tmp/...` 隔离数据目录。本次通过移动真实数据目录完成安全验收，未发现数据丢失，但该方式不适合长期自动化。

建议后续增加测试/开发专用的数据根目录覆盖能力，例如受控环境变量或启动参数，并且仅在非生产构建或显式测试模式下启用。

### 5.2 更新检查旁路噪音

启动时仍出现：

```text
No published versions on GitHub
```

该问题与 C-05 已记录的真实升级演练阻塞一致。本次账户流程不依赖更新服务，因此不阻塞 D-02 通过，但仍阻塞正式发布更新验收。

## 6. 结论

D-02 已完成。LifeOS 1.0.2 打包应用的首次启动、账户创建、密码保护、错误密码拦截、退出登录、账户切换和重启账户保留均通过。当前无 D-02 级别发布阻塞项；C-05 真实更新演练阻塞仍保持独立开放。
