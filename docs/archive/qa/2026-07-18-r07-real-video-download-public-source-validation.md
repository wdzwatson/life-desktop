# R-07 公开视频真实下载与失败恢复验收

- 日期：2026-07-18
- 状态：公开源闭环已完成；Cookie / 会员授权场景待真实登录态
- 环境：macOS x64，`/tmp` 隔离工具与下载目录

## 1. 安全与范围边界

- 未使用真实 `~/LifeOS` 数据。
- 未读取浏览器 Cookie、账号或钥匙串。
- 工具和下载文件全部放在临时隔离目录，测试后删除。
- 使用公开、无需登录、约 5 秒的小型 MP4 测试源：`https://samplelib.com/mp4/sample-5s.mp4`。

## 2. 受管工具安装

通过 LifeOS 自身的 `installManagedVideoTool` 路径完成真实安装并检测：

| 工具 | 版本 | 结果 |
| --- | --- | --- |
| yt-dlp | `2026.07.04` | 安装并检测通过 |
| ffmpeg | `8.1.2-tessus` | ZIP 下载、解压、执行检测通过 |

## 3. 首轮发现与修复

首次安装后的公开 URL metadata 解析超过原有 30 秒超时，返回：

```text
Process timed out after 30000ms
```

随后使用同一工具执行真实下载能够成功，说明问题是 macOS 首次启动受管 yt-dlp 的冷启动时间，而不是工具损坏或 URL 不可用。

修复：

- 新增 `DEFAULT_VIDEO_METADATA_TIMEOUT_MS = 60000`。
- 单视频 metadata 和 Bilibili flat metadata 探测统一使用 60 秒边界。
- 自动化测试确认工具检查和 metadata 探测均允许经过验证的慢启动窗口。

## 4. 修复后真实复测

| 验收项 | 结果 |
| --- | --- |
| yt-dlp / ffmpeg 工具检测 | 通过 |
| 公开 URL 首次解析 | 通过，`diagnostic.code = ok` |
| 解析类型 | `single` |
| 解析标题 | `sample-5s` |
| 无效 URL 失败反馈 | 通过，返回真实 HTTP 403 原因 |
| 修正 URL 后重试 | 通过 |
| 下载文件 | `sample-5s.mp4` |
| 文件大小 | 2,848,208 bytes |
| 下载进度 | 到达 99%，随后进入完成处理 |
| 安全播放 URL | `life-video://play/...` 生成成功 |
| protocol 路径还原 | 与真实下载绝对路径一致 |
| ffmpeg 完整解码 | 退出码 0 |
| 临时数据清理 | 已完成 |

## 5. 回归结果

| 检查 | 结果 |
| --- | --- |
| 全量测试 | 246 + 20 + 11 + 10 全部通过 |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，DMG / ZIP / blockmap 生成成功 |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| `git diff --check` | 通过 |

视频工具检测、URL 规范化、下载参数、进度、失败反馈、播放路径、Cookie 参数边界和数据库状态测试均通过；任务、笔记、书籍、保险箱和备份恢复未发现回归。

## 6. 未完成边界

以下场景不能由无登录态的本地代理替代，仍需用户配合：

- 浏览器 Cookie 读取授权。
- Bilibili 登录、会员或受限视频权限。
- Cookie 过期后重新登录与恢复。

因此 R-07 的“公开源真实下载”部分已关闭；“Cookie 授权成功或真实授权失败”部分继续保留为外部验收项。

## 7. 已知发布条件

macOS 安装包仍因本机没有有效 Developer ID Application identity 而跳过签名，属于既有 R-01 阻塞，与本次视频下载验收无关。

## 8. 结论

LifeOS 已完成真实公开视频的工具安装、解析、失败、重试、下载、本地安全路径和 ffmpeg 解码闭环。首次 metadata 冷启动误报超时已修复，其他核心功能回归通过。
