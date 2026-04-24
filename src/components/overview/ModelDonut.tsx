import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import type { ModelShare } from '@/types/api'
import { formatNumber, formatPercent } from '@/lib/format'
import { useSettings } from '@/stores/settings'

interface Props {
  data: ModelShare[]
}

const PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4']

export function ModelDonut({ data }: Props) {
  const { theme } = useSettings()
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  const total = data.reduce((s, d) => s + d.totalTokens, 0)

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? '#0f172a' : '#ffffff',
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        textStyle: { color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/><b>${p.value.toLocaleString()}</b> (${p.percent.toFixed(1)}%)`,
      },
      color: PALETTE,
      series: [
        {
          type: 'pie',
          radius: ['62%', '85%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderColor: isDark ? '#0f172a' : '#ffffff',
            borderWidth: 3,
          },
          data: data.map((d) => ({ name: d.model, value: d.totalTokens })),
        },
      ],
    }),
    [data, isDark],
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[170px_minmax(0,1fr)] gap-4 items-center min-w-0">
      <div className="relative h-[180px] 2xl:h-[170px] min-w-0">
        <ReactECharts option={option} style={{ height: '100%' }} notMerge lazyUpdate />
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-xs text-slate-500 dark:text-slate-400">总计</div>
          <div className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums max-w-[120px] truncate">
            {formatNumber(total)}
          </div>
        </div>
      </div>
      <ul className="space-y-2.5 min-w-0">
        {data.map((d, i) => (
          <li
            key={d.model}
            className="grid grid-cols-[minmax(0,1fr)_max-content_48px] items-center gap-3 text-sm min-w-0"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span className="text-slate-700 dark:text-slate-200 truncate">{d.model}</span>
            </span>
            <span className="text-slate-600 dark:text-slate-300 tabular-nums text-right">
              {formatNumber(d.totalTokens)}
            </span>
            <span className="text-slate-400 text-xs tabular-nums text-right">
              {formatPercent(d.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
