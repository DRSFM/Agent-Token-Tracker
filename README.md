# Agent Token Tracker

本地 Agent Token 计数器 — 估算 Claude Code、Codex CLI 等本地命令行 AI 工具的 token 消耗。

订阅账号登录方式没有官方使用面板，本工具读取这些工具落在本地的会话日志做粗略统计（不追求 API 级精确）。所有数据都在本机处理，不会上传到任何远端服务。

## 功能

- **概览**：今日 / 7 天 / 30 天 token 与请求数，趋势折线、模型占比、会话排行、活跃热力图、最近请求列表
- **会话**：按 sessionId 聚合，支持搜索、按 token / 请求数 / 最近活跃排序
- **回放**：按会话读取 JSONL 历史，以聊天记录方式展示用户输入与最终助手回复
- **模型**：各模型用量分布、走势 sparkline
- **趋势**：按日 token 变化，可按数据来源（Claude Code / Codex）拆分查看
- **Codex 余量**：查看 Codex 账号的 5 小时与 7 天剩余额度，支持自己的账号 / 其余来源分组、隐藏账号与手动刷新
- **Codex 账号管理**：支持账号标签与备注、CLI 启动、桌面端切换启动、导出凭证 JSON、删除本地凭证
- **Codex 账号导入**：支持 OpenAI 官方 OAuth 授权、粘贴 `auth.json` / 账号 JSON / `refresh_token`、导入 API Key、从本机已登录 Codex 或本地 JSON 文件导入
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

### Codex 账号与余量

「余量」页可集中查看本地 Codex 账号的剩余额度，并为凭证添加标签和备注。账号卡片支持直接启动隔离的 Codex CLI，或切换到选中凭证后启动 Codex 桌面端。

「添加账号」支持 OAuth 授权、Token / JSON、API Key、本地已登录账号和本地 JSON 文件导入。订阅账号可查询 ChatGPT 5 小时 / 7 天额度；API Key 账号会作为独立凭证保存，但不参与订阅额度查询。

Team、Business、多账号等凭证会自动使用账号 ID 查询额度；过期的 OAuth token 会在有 `refresh_token` 时自动刷新。

### 历史回放

会话页可在详情中打开「回放」预览，也可以进入左侧导航的「回放」页进行大屏阅读。回放模式默认只展示用户输入和同一轮最终助手回复；工具调用、阶段性过程和完整 JSONL 仍保留在「原始事件」里用于排查。

回放内容支持图片附件、Markdown 图片、表格以及常见 KaTeX 公式。代码块内的 `$...$` 会按代码原样显示，这是刻意保留的 Markdown 行为。

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
