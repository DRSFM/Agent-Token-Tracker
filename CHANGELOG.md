# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号采用 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.2.0] - 2026-04-28

### Added
- 新增「回放」页面，可按会话加载 Claude Code / Codex JSONL 历史并以聊天记录方式阅读
- 会话详情增加「回放 / 原始事件」标签：回放只展示用户输入与最终助手回复，原始事件保留完整 JSONL 调试内容
- 回放支持图片附件、Markdown 图片、GFM 表格、行内与块级 KaTeX 公式渲染
- 回放页增加沉浸全屏模式，隐藏应用侧栏、顶部栏和会话列表，仅保留对话阅读区

### Changed
- Codex / Claude Code 回放读取改为按候选 JSONL 文件加载，避免远程缓存开启时误扫大量无关文件
- 回放模式会压缩同一轮的多条 assistant 阶段性消息，仅保留最终总结；工具调用与中间过程仍可在「原始事件」查看
- 会话页详情回放跳转到独立大屏回放页，长会话阅读空间更宽

### Fixed
- 修复回放请求在前端 effect 依赖变化时被反复取消，导致界面长时间停在 loading 的问题
- 修复图片 XML 包裹文本、Markdown 表格和公式在回放里显示成纯文本的问题
- 修复 KaTeX CSS import 顺序导致的构建警告

## [1.1.6] - 2026-04-26

### Fixed
- 给 `release:installer` / `release:mac` / `release:portable` 加 `--publish never` 标记，阻止 electron-builder 在打 tag 时自作主张去 GitHub 上传产物（缺 `GH_TOKEN` 会导致整个 job 失败）。GitHub Release 上传由 workflow 里的 softprops/action-gh-release 统一处理

## [1.1.5] - 2026-04-26

### Fixed
- 应用图标升到 1024x1024，让 macOS dmg 构建能通过 electron-builder 的 512 最低尺寸校验
- `package.json` 补 `repository` / `homepage` / `bugs` / `keywords` 字段，npm 发布带 `--provenance` 时校验通过

### Note
- npm 1.1.4 已在 registry 但当时 macOS dmg 构建失败、GitHub Release 未生成；1.1.5 是第一个三平台 + npm 全部齐整的版本

## [1.1.4] - 2026-04-25

### Removed
- 清掉公开仓库里残留的 vibe-coding 编排器过程文件（`outputs/runtime/vibe-sessions/`、`docs/plans/`、`docs/requirements/`）
- `.claude/` 目录加入 .gitignore 防止本机元数据外泄

### Changed
- 与 1.1.3 功能完全一致，仅做仓库清理

## [1.1.3] - 2026-04-25

### Added
- TopBar 全局搜索框可用：输入关键词回车跳转到会话页（支持 ⌘K / Ctrl+K 快捷键聚焦）
- TopBar 数据状态徽标：显示数据源健康状态与最近扫描时间，点击重新扫描
- TopBar 主题快捷切换按钮：浅色 / 深色 / 跟随系统循环
- 概览页「最近请求 → 查看全部」可跳转到会话页
- 公共 README 重写为面向终端用户的版本，并附 LICENSE (MIT)

### Changed
- 概览页未连接到本地数据源时的提示文案改为「未连接到本地数据源 — 显示示例数据」
- 内部 Codex 交接文档移出仓库，仅保留在本地

## [1.1.2] - 2026-04

### Added
- npm 发布自动化脚本

## [1.1.1] - 2026-04

### Added
- npm 包分发支持，可通过 `npm install -g agent-token-tracker` 安装命令行入口

## [1.1.0] - 2026-04

### Added
- SSH 远端日志同步：在另一台机器跑 Claude Code / Codex CLI 的用户可以在本机汇总查看
- 设置页远程数据源配置 + 测试连接 + 手动同步入口

## [1.0.1] - 2026-04

### Changed
- 使用正式版内置背景图替换早期占位素材

## [1.0.0] - 2026-04

### Added
- 首个发布版本
- 概览 / 会话 / 模型 / 趋势 四个数据页
- 本地扫描 Claude Code (`~/.claude/projects`) 与 Codex CLI (`~/.codex/sessions`) 日志
- 增量缓存 + chokidar 实时监听
- 浅色 / 深色 / 跟随系统主题，自定义背景图与不透明度
- 静默背景欣赏模式
- Windows NSIS 安装包与 portable 版本，macOS dmg
- GitHub Releases 自动更新
