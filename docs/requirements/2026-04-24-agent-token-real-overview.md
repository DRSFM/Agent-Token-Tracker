# Agent Token Tracker Real Overview Requirement

Date: 2026-04-24
Runtime: vibe

## Goal

Connect the dashboard overview to real local Claude Code and Codex session logs instead of mock data.

## Deliverable

- Claude Code and Codex JSONL scanners that normalize records into the shared `RequestRecord` contract.
- An in-memory aggregation layer backing the existing Electron IPC methods.
- Overview UI showing weighted total tokens plus raw/cache token context.
- Light governance receipts under `outputs/runtime/vibe-sessions/2026-04-24-agent-token-real-overview/`.

## Constraints

- Do not add realtime file watching or persistent cache in this first pass.
- Do not implement Sessions, Models, or Trends pages beyond existing overview data use.
- Keep Codex token total as reported by `last_token_usage.total_tokens`.
- Count Claude cache tokens at 0.1x in weighted totals.

## Acceptance Criteria

- `npm run lint` passes.
- `npm run build` passes.
- The overview page can load through real IPC without falling back to mock data.
- Malformed JSONL lines do not abort scanning.
- Missing source directories do not crash the app.

