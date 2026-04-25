# Agent Token Tracker

本地 Agent Token 计数器 — 估算 Claude Code、Codex CLI 等本地命令行 AI 工具的 token 消耗。账号登录方式没有官方使用面板，本工具读取这些工具落在本地的会话日志做粗略统计（不追求 API 级精确）。

## 技术栈

- **Electron** (主进程，文件读取/IPC)
- **Vite + React + TypeScript** (渲染进程)
- **Tailwind CSS** (样式)
- **ECharts** (图表)
- **Zustand** (前端状态)

## 启动

```bash
npm install
npm run dev          # 启动 Vite + Electron 开发模式
npm run electron:build  # 打包桌面应用
```

## npm 安装

```bash
npm install -g agent-token-tracker
agent-token-tracker
```

也可以直接安装本地打出的 tarball：

```bash
npm install -g ./agent-token-tracker-*.tgz
agent-token-tracker
```

npm 版本适合命令行用户；普通桌面用户仍建议使用 GitHub Releases 里的安装包或 dmg。

首次启动若不在 Electron 中（纯浏览器访问 `http://localhost:5173`），前端会自动落到 `src/lib/mock.ts` 的 mock 数据。

## 目录结构

```
electron/
├── main.ts             # Electron 主进程入口（窗口管理）
├── preload.ts          # IPC 桥（暴露 window.tokenAPI）
└── ipc-handlers.ts     # ⚠️ Codex 需要实现 — 当前全部 throw

src/
├── types/api.ts        # 🔒 前后端共享契约（修改需同步 preload + ipc-handlers）
├── lib/
│   ├── api.ts          # 渲染进程 API 客户端，自动选择 IPC / mock
│   ├── mock.ts         # 开发期 mock 数据
│   ├── format.ts       # 数字/时间格式化
│   └── utils.ts        # cn() 工具
├── stores/settings.ts  # 主题 / 背景图持久化（localStorage）
├── components/
│   ├── ui/             # Card / Select 等基础组件
│   ├── layout/         # Sidebar / TopBar / AppShell
│   └── overview/       # 概览页所有图表/列表组件
└── pages/
    ├── OverviewPage.tsx   # ✅ 完整实现
    ├── SessionsPage.tsx   # 占位
    ├── ModelsPage.tsx     # 占位
    ├── TrendsPage.tsx     # 占位
    └── SettingsPage.tsx   # ✅ 主题 + 背景图上传
```

## 分工

### Claude Code 已完成（前端）
- 整体布局（侧栏、顶栏、路由）
- 概览页全部组件（4 卡片、趋势折线、模型甜甜圈、会话排行、热力图、最近请求）
- 浅色 / 深色 / 跟随系统主题切换
- 自定义背景图上传 + 不透明度调节
- Mock 数据层和 `useAsync` Hook

### Codex 需要实现（主进程 / 数据层）

所有改动都在 `electron/ipc-handlers.ts`，按 `src/types/api.ts` 中的 `TokenAPI` 接口实现真实数据返回：

#### 1. Claude Code 数据源
- 路径：`~/.claude/projects/**/*.jsonl`
- 每行是一次完整的 message，关键字段：
  ```json
  {
    "type": "assistant",
    "timestamp": "2026-04-24T...",
    "sessionId": "...",
    "message": {
      "model": "claude-...",
      "usage": {
        "input_tokens": 123,
        "output_tokens": 456,
        "cache_read_input_tokens": 789,
        "cache_creation_input_tokens": 0
      }
    },
    "cwd": "/path/to/project"   // 可用作 sessionTitle 的来源
  }
  ```
- `sessionId` 即取该字段；`sessionTitle` 可以从 `cwd` 提取最后一段，或从首条 user message 截前 N 字
- `totalTokens = input + output + cache_read + cache_creation`

#### 2. Codex CLI 数据源
- 默认目录可能是 `~/.codex/sessions/` 或类似（请 Codex 自行确认）
- 解析逻辑同 Claude Code，转换成统一的 `RequestRecord`
- 若一时拿不到，可先返回空数组（数据源状态显示为半健康即可）

#### 3. 监听 + 缓存
- 用 `chokidar` 监听上述目录的新增/修改
- 增量解析后向所有窗口 `webContents.send('token:dataChanged')`
- 持久化索引建议放 `app.getPath('userData') + '/cache.json'`，启动时用增量扫描
- `getDataSourceStatus()` 返回 `{ kind: 'local-estimate', label: '本地估算', lastUpdatedAt: ISO, healthy: bool }`

#### 4. 聚合层
所有 `getXxx(range)` 方法都拿 RequestRecord 池做内存聚合：
- 按日 group → DailyTrendPoint
- 按 model group + 占比 → ModelShare
- 按 sessionId group + 排序 → SessionSummary
- 按 (weekday, hour) bucket → HeatmapCell

实现起来不复杂，但需要严格按 `src/types/api.ts` 中的字段名，否则前端不渲染。

## 修改契约的流程

如果 Codex 在实现过程中发现需要扩展字段（例如要带成本估算），三处必须同步：
1. `src/types/api.ts` — 加字段
2. `electron/preload.ts` — 不需要改（除非加新方法）
3. `src/lib/mock.ts` — 同步 mock，否则前端开发期断
4. `electron/ipc-handlers.ts` — 加真实实现

## 已知小坑
- 路径包含中文（`F:\vscode代码\agent token 记录`），跨平台脚本里若要用绝对路径请 URL 编码
- Electron 在 macOS 用了 `titleBarStyle: 'hiddenInset'`，Windows 上窗口控件在 TopBar 区域，已用 `titlebar-drag` / `titlebar-no-drag` CSS 类划分拖拽区
