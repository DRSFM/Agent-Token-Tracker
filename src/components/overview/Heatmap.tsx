import type { HeatmapCell } from '@/types/api'

interface Props {
  data: HeatmapCell[]
}

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function Heatmap({ data }: Props) {
  const max = Math.max(...data.map((d) => d.totalTokens), 1)
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const c of data) grid[c.weekday][c.hour] = c.totalTokens

  const colorFor = (v: number) => {
    if (v === 0) return 'rgba(148, 163, 184, 0.08)'
    const t = Math.min(1, v / max)
    const alpha = 0.15 + t * 0.85
    return `rgba(59, 130, 246, ${alpha.toFixed(2)})`
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[36px_1fr] gap-2">
        <div className="flex flex-col gap-[3px] text-[10px] text-slate-400">
          {WEEK_LABELS.map((w) => (
            <div key={w} className="h-[14px] leading-[14px]">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-rows-7 gap-[3px]">
          {grid.map((row, ri) => (
            <div key={ri} className="grid grid-cols-24 gap-[3px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0,1fr))' }}>
              {row.map((v, hi) => (
                <div
                  key={hi}
                  title={`${WEEK_LABELS[ri]} ${hi}:00 — ${v.toLocaleString()} tokens`}
                  className="h-[14px] rounded-[3px] hover:ring-2 hover:ring-brand-500/40 transition"
                  style={{ background: colorFor(v) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[36px_1fr] gap-2">
        <div />
        <div className="flex justify-between text-[10px] text-slate-400">
          <span>0时</span>
          <span>4时</span>
          <span>8时</span>
          <span>12时</span>
          <span>16时</span>
          <span>20时</span>
        </div>
      </div>
      <div className="grid grid-cols-[36px_1fr] gap-2 mt-1">
        <div />
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span>低</span>
          <div className="flex-1 h-2 rounded-full bg-gradient-to-r from-blue-100 via-blue-300 to-blue-600 dark:from-blue-900 dark:via-blue-700 dark:to-blue-400" />
          <span>高</span>
        </div>
      </div>
    </div>
  )
}
