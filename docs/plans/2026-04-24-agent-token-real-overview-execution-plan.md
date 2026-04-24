# Agent Token Tracker Real Overview Execution Plan

Date: 2026-04-24
Runtime: vibe
Internal grade: L

## Waves

1. Freeze lightweight governance artifacts.
2. Add local JSONL scanners for Claude Code and Codex.
3. Add in-memory aggregation and IPC handlers.
4. Extend the shared contract, mock data, and overview stat card.
5. Verify with TypeScript and production build.

## Ownership

- Main process data logic owns scanning, normalization, aggregation, and IPC.
- Renderer changes are limited to the overview total stat card and mock contract updates.
- No subagents or parallel child-governed lanes are used.

## Verification

- `npm run lint`
- `npm run build`
- Manual check: run `npm run dev`, verify the mock badge disappears and overview data is populated from local logs.

## Cleanup

- Leave runtime receipts in the configured vibe session directory.
- Do not add temporary scratch files.

