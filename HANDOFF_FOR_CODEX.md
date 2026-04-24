# Codex 接手任务清单

> 给 Codex 看的精简版。完整说明见 [`README.md`](./README.md)。

## 当前状态（2026-04）

- ✅ Codex 已实现 `electron/aggregator.ts` + `electron/scanners/`，真实数据已接通
- ✅ 前端已上 4 个完整页面：概览 / 会话 / 模型 / 趋势，外加设置
- 前端在新页面（Sessions/Models/Trends）目前用 `getRecentRequests(50000)` 拉全量记录、客户端聚合，详见下方"可选优化接口"

## 字段约定（已稳定）

`RequestRecord` 上 Codex 加了三个可选字段，前端已用：
- `cacheTokens` — 缓存读 + 写 总量
- `rawTotalTokens` — 未加权原始总量
- `weightedTotalTokens` — 加权后总量（= `totalTokens`）

`OverviewStats` 上多了 `todayRawTotalTokens` / `todayCacheTokens`，已显示在"今日总 Tokens"卡片的副信息行。

如还要加新字段，照旧改 `src/types/api.ts`；TS 会立刻指引前端补 mock 与渲染。

## 可选优化接口（不急，性能瓶颈才需要）

前端目前一次性拉 5 万条记录做客户端聚合。当本地记录到达 ~5 万这一量级、或单次 IPC payload 太大影响启动时，下面这些后端接口能显著降负载。

### 1. `listSessions`
按筛选返回会话列表，比客户端聚合更省。

```ts
listSessions(
  range: DateRange,
  opts: {
    source?: AgentSource | 'all'
    search?: string         // 标题 / sessionId / model 任一包含
    sortBy: 'tokens' | 'requests' | 'lastActive'
    sortDesc: boolean
    limit: number
    offset: number
  },
): Promise<{ items: SessionAggregate[]; total: number }>
```

`SessionAggregate` 比当前 `SessionSummary` 多带：
- `inputTokens / outputTokens / cacheTokens`（汇总）
- `firstActiveAt`
- `models: { model: string; tokens: number; count: number }[]`

> 形状已在 `src/lib/aggregations.ts` 的 `SessionAggregate` 定义，可直接照抄到 `src/types/api.ts`。

### 2. `getSessionDetail`
单会话页用：

```ts
getSessionDetail(sessionId: string): Promise<{
  session: SessionAggregate
  requests: RequestRecord[]      // 该会话所有请求，按时间倒序
  dailySeries: DailyTrendPoint[] // 最近 30 天 token 走势
}>
```

### 3. `getDailyTrendBySource`
趋势页"来源对比"堆叠图用：

```ts
getDailyTrendBySource(range: DateRange): Promise<{
  date: string                                  // YYYY-MM-DD
  bySource: Record<AgentSource, number>
  total: number
}[]>
```

### 4. `getModelTrend`
模型页 sparkline 用：

```ts
getModelTrend(range: DateRange): Promise<{
  model: string
  daily: DailyTrendPoint[]                      // 与 range 长度对齐
}[]>
```

### 切换路径
当上面任一接口实现后，前端只需把 `useAllRequests` 替换成对应的 `useAsync(api.xxx)` 即可，组件签名不动。

## 关键路径回顾

### Claude Code
```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

### Codex CLI
```
~/.codex/sessions/**/*.jsonl
```

## 验证
- `npm run dev` 启动
- 概览页右上角的 "Mock 数据" 角标消失 = IPC 通
- 各页 4 种状态（loading / empty / error / success）可手动验：
  - **loading**: 首次启动尚未扫描完成时短暂显示
  - **empty**: 切换到一个无记录的窗口（比如 7 天范围 + Codex 来源）
  - **error**: 临时把 `aggregator.ts` 某个方法 throw 一下，前端会自动捕获并显示重试按钮
