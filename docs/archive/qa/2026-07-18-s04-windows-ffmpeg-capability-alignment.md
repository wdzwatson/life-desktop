# S-04 Windows ffmpeg 安装能力与界面承诺对齐

- 日期：2026-07-18
- 状态：已完成
- 影响范围：视频下载器设置、preload 平台能力、视频工具安装

## 1. 问题

设置页在所有平台都显示“安装内置 ffmpeg”，但后端只实现了 macOS ffmpeg ZIP 下载和解压。Windows / Linux 用户点击该按钮会收到“不支持”错误，界面承诺与实际能力不一致。

## 2. 处理决策

本轮遵循 RC 不扩大功能范围原则，不新增未经验证的 Windows ffmpeg 下载源。处理方式为：

- macOS 保留“安装内置 ffmpeg”。
- Windows / Linux 隐藏不可用的内置安装按钮。
- 在 ffmpeg 路径输入框下显示中英文人工安装说明。
- yt-dlp 的 macOS / Windows / Linux 内置安装能力保持不变。

## 3. 修改

- 新增 `electron/video/toolSupport.ts`，集中定义受管视频工具安装能力。
- preload 暴露当前平台和受管工具支持矩阵。
- 视频服务在生成下载计划前统一执行能力检查。
- 设置页根据 preload 能力显示 ffmpeg 安装按钮或人工安装说明。
- 操作按钮组允许换行，避免窄宽度下溢出。
- 新增中英文人工安装说明。
- 新增平台能力和本地化自动化测试。

## 4. 验证结果

| 检查 | 结果 |
| --- | --- |
| 视频工具专项测试 | 29 / 29 通过 |
| 平台能力矩阵 | macOS ffmpeg=true；Windows/Linux ffmpeg=false；yt-dlp 按已实现平台开放 |
| 中英文人工安装说明 | 通过 |
| 全量测试 | 245 + 20 + 11 + 10 全部通过 |
| `npm run build` | 通过 |
| `npm run lint` | 通过 |
| `npm run build:app` | 通过，DMG / ZIP / blockmap 生成成功 |
| `npm audit --audit-level=high` | 通过，0 vulnerabilities |
| 新增文件与本地化 Prettier 检查 | 通过 |
| macOS 设置页浏览器检查 | 通过，ffmpeg 安装按钮保留，按钮组无溢出，无控制台错误 |

## 5. 对其他功能的影响

- 视频解析、下载参数、Cookie、播放路径和失败反馈专项测试全部通过。
- macOS 已实现的 ffmpeg 安装流程未改变。
- Windows / Linux 用户仍可在安装 ffmpeg 后填写完整可执行文件路径。
- 数据库、保险箱、备份恢复、任务、笔记、书籍和其他设置功能未发现回归。

## 6. 验收边界

本次完成的是能力承诺对齐和自动化回归。Windows 实机页面显示及手工配置 ffmpeg 后的真实下载，仍由 Windows runner / R-07 平台验收覆盖。

## 7. 结论

Windows / Linux 不再展示必然失败的内置 ffmpeg 安装入口，界面改为给出真实可执行的人工配置说明；macOS 原有能力和其他核心功能保持正常。
