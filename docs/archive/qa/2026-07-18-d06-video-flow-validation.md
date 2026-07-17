# D-06 视频流程验收

日期：2026-07-18
任务：D-06
状态：已完成
目标版本：LifeOS 1.0.2
执行包：`dist_electron/mac/LifeOS.app`
验收方式：打包应用 + Playwright 连接 Electron DevTools Protocol + 应用内数据库 API + 本地播放协议核验

## 1. 验收目标

验证视频模块的工具检测、公开 URL 解析、分组、标签、下载失败、重试、本地播放、批量标签操作和重启恢复流程，并确认缺少外部工具时用户能看到明确反馈，原始数据不被破坏。

## 2. 本轮修复

本轮未修改业务代码。D-06 使用既有打包应用执行验收，未发现需要立即修复的 D-06 阻塞缺陷。

## 3. 数据保护

- 执行前确认并关闭残留 LifeOS 进程。
- 将真实数据目录 `/Users/mac/LifeOS` 临时移动到 `/Users/mac/LifeOS.codex-d06-backup-20260718-001`。
- 使用干净数据目录执行 D-06 验收。
- 验收完成后将 D-06 数据目录移动到 `/tmp/LifeOS.codex-d06-evidence-20260718-001`。
- 已将原始 `/Users/mac/LifeOS` 恢复到原路径。

## 4. 安装包证据

```text
b7403620672b26417073fa3de78c09fe5527e2216cb394beb852d46c99a6ec93  dist_electron/LifeOS-1.0.2.dmg
0f9591f03d214bc687fbd101770cd3df797d4a44dd5dd272cc042eb3ca7458e4  dist_electron/LifeOS-1.0.2-mac.zip
```

## 5. 样例与外部源

公开解析源：

```text
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

解析结果：

```text
source=youtube
title=Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)
diagnostic=Parsed YouTube metadata quickly.
```

失败/受限源：

```text
https://www.bilibili.com/video/BV1G7jJ6nEbV/
```

本地播放样例：

```text
/Users/mac/LifeOS/users/guest/files/videos/d06-local-playback.mov
```

样例来源为 macOS 系统内置 MOV 资源的临时副本，仅用于验证本地播放协议；验收完成后随 D-06 临时数据目录转存到 `/tmp`。

## 6. 验收记录

| ID | 场景 | 实际结果 | 状态 |
|---|---|---|---|
| D06-01 | 干净启动 | 新数据目录启动后进入 `guest`，视频库为空 | 通过 |
| D06-02 | 工具检测 | 应用检测到 `yt-dlp` 和 `ffmpeg` 均缺失，并显示 `下载插件加载失败` 与具体 ENOENT 信息 | 通过 |
| D06-03 | 公开 URL API 解析 | YouTube 单视频通过 oEmbed 快速解析为 `source=youtube`，返回标题、缩略图和 `ok` 诊断 | 通过 |
| D06-04 | 公开 URL UI 解析 | 在视频页输入公开 URL 后，解析弹窗展示标题、诊断、分组选择和标签输入 | 通过 |
| D06-05 | 分组与标签 | 创建 `D06 验收分组`，三条视频均归入该分组；标签 `D06-public`、`D06-local`、`D06-failure` 在侧栏显示 | 通过 |
| D06-06 | 本地播放 | `D06 本地播放样例` 以 `downloaded` 状态展示；点击播放后打开播放器，`life-video://play/...` URL 可用，视频元素 `readyState=4` 且无错误 | 通过 |
| D06-07 | 播放路径安全 | 请求 `/etc/passwd` 播放 URL 被拒绝，返回 `Playback path is outside the video library.` | 通过 |
| D06-08 | 下载失败 | 在缺少 `yt-dlp` / `ffmpeg` 的状态下触发下载，数据库落为 `download_failed`，错误信息明确指出缺失组件 | 通过 |
| D06-09 | 重试失败反馈 | 再次触发同一受限源下载仍保持 `download_failed`，诊断信息保留 | 通过 |
| D06-10 | 批量标签 | 对公开视频和本地视频批量添加 `D06-bulk`，并从公开视频移除 `D06-public`，数据库结果正确 | 通过 |
| D06-11 | 重启持久化 | 重启后视频记录、分组、标签、失败状态和本地播放 URL 均保留 | 通过 |

## 7. 数据库核验摘要

重启后视频摘要：

```text
1 Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)
  status=not_downloaded
  tags=D06-bulk

2 D06 本地播放样例
  status=downloaded
  local_path=/Users/mac/LifeOS/users/guest/files/videos/d06-local-playback.mov
  tags=D06-local,D06-bulk

3 D06 受限源失败验证
  status=download_failed
  tags=D06-failure
  error=Missing or invalid video download component: yt-dlp ... ffmpeg ...
```

工具检测摘要：

```text
yt-dlp ok=false path=yt-dlp error=spawn yt-dlp ENOENT
ffmpeg ok=false path=ffmpeg error=spawn ffmpeg ENOENT
```

播放安全摘要：

```text
inside library: life-video://play/%2FUsers%2Fmac%2FLifeOS%2Fusers%2Fguest%2Ffiles%2Fvideos%2Fd06-local-playback.mov
outside library: rejected
```

## 8. 已知限制

- 本轮干净测试环境没有安装 `yt-dlp` 和 `ffmpeg`，因此真实外网下载成功路径未完成；D-06 覆盖的是工具缺失、失败、重试和本地播放闭环。安装工具后的真实下载成功率仍建议单独补充。
- 公开 URL 解析依赖 YouTube oEmbed；本轮实测 `https://www.youtube.com/watch?v=dQw4w9WgXcQ` 可解析，另一个 YouTube 测试 URL 回退到缺工具诊断，说明外部源状态会影响验收结果。
- 受限源场景以 Bilibili URL 和缺工具诊断完成失败处理验证；Cookie 授权成功路径未在本轮完成。
- 自动更新检查仍输出 `No published versions on GitHub`，与 C-05 真实升级演练阻塞一致，不影响 D-06 视频流程验收。
- 打包应用仍固定使用 `/Users/mac/LifeOS` 作为数据根目录，本次继续通过临时移动真实数据目录完成隔离；建议后续增加受控测试数据根目录能力。

## 9. 验证命令

```text
npm test
npm run build
npm run lint
git diff --check
```

结果：全部通过。

## 10. 结论

D-06 已完成。视频模块在当前工具缺失环境下可正确提示依赖问题，公开 URL 解析、分组、标签、本地播放、安全路径限制、失败/重试反馈、批量标签和重启恢复均通过。真实下载成功和 Cookie 授权成功路径仍建议在安装视频工具后追加验收。
