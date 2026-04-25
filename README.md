# Agent Token Tracker

本地 Agent Token 计数器 — 估算 Claude Code、Codex CLI 等本地命令行 AI 工具的 token 消耗。

订阅账号登录方式没有官方使用面板，本工具读取这些工具落在本地的会话日志做粗略统计（不追求 API 级精确）。所有数据都在本机处理，不会上传到任何远端服务。

## 功能

- **概览**：今日 / 7 天 / 30 天 token 与请求数，趋势折线、模型占比、会话排行、活跃热力图、最近请求列表
- **会话**：按 sessionId 聚合，支持搜索、按 token / 请求数 / 最近活跃排序
- **模型**：各模型用量分布、走势 sparkline
- **趋势**：按日 token 变化，可按数据来源（Claude Code / Codex）拆分查看
- **设置**：浅色 / 深色 / 跟随系统主题，自定义背景图与不透明度
- **自动刷新**：监听日志目录变更，新会话写入后界面会自动更新

## 支持的数据来源

| 工具 | 默认日志路径 |
| --- | --- |
| Claude Code | `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` |

## 安装

### 桌面安装包（推荐普通用户）

到 [GitHub Releases](https://github.com/DRSFM/Agent-Token-Tracker/releases) 下载对应平台的安装包：

- Windows：`Agent-Token-Tracker-Setup-<version>.exe`
- macOS：`Agent-Token-Tracker-<version>-mac-<arch>.dmg`

### npm 全局安装（命令行用户）

```bash
npm install -g agent-token-tracker
agent-token-tracker
```

也可以直接安装本地打出的 tarball：

```bash
npm install -g ./agent-token-tracker-*.tgz
agent-token-tracker
```

## 使用

启动后会自动扫描 Claude Code 和 Codex CLI 的本地日志目录，无需配置。如果对应工具尚未在本机产生日志，对应来源会显示为空。

热力图按 `(weekday, hour)` 统计活跃度；最近请求列表实时反映最新写入的会话条目。

## 隐私

- 所有解析与聚合都在本地完成
- 不发送任何请求到外部服务（除桌面版的应用更新检查）
- 缓存索引存放于系统的 `userData` 目录下 `cache.json`

## 从源码构建

```bash
npm install
npm run dev              # 启动 Vite + Electron 开发模式
npm run electron:build   # 打包桌面应用
```

技术栈：Electron + Vite + React + TypeScript + Tailwind CSS + ECharts + Zustand。

## 协议

MIT
