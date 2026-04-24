import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import type { DailyTrendPoint } from '@/types/api'
import { formatCompact } from '@/lib/format'
import { useSettings } from '@/stores/settings'

interface Props {
  data: DailyTrendPoint[]
}

export function DailyTrendChart({ data }: Props) {
  const { theme } = useSettings()
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  const option = useMemo(() => {
    const labels = data.map((d) => {
      const dt = new Date(d.date)
      return `${dt.getMonth() + 1}/${dt.getDate()}`
    })
    const values = data.map((d) => d.totalTokens)
    const lastIdx = values.length - 1
    return {
      grid: { left: 50, right: 24, top: 24, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#0f172a' : '#ffffff',
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        textStyle: { color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
        formatter: (params: { axisValue: string; value: number }[]) => {
          const p = params[0]
          return `${p.axisValue}<br/><b>${p.value.toLocaleString()}</b> tokens`
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } },
        axisLabel: { color: isDark ? '#94a3b8' : '#94a3b8', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9', type: 'dashed' },
        },
        axisLabel: {
          color: isDark ? '#94a3b8' : '#94a3b8',
          fontSize: 11,
          formatter: (v: number) => formatCompact(v),
        },
      },
      series: [
        {
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: false,
          data: values,
          lineStyle: { width: 2.5, color: '#3b82f6' },
          itemStyle: { color: '#3b82f6', borderColor: '#fff', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(59,130,246,0.25)' },
                { offset: 1, color: 'rgba(59,130,246,0)' },
              ],
            },
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 10,
            itemStyle: { color: '#3b82f6', borderColor: '#fff', borderWidth: 2 },
            label: {
              show: true,
              position: 'top',
              formatter: () => values[lastIdx].toLocaleString(),
              backgroundColor: '#3b82f6',
              color: '#fff',
              padding: [4, 8],
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
            },
            data: [{ coord: [lastIdx, values[lastIdx]] }],
          },
        },
      ],
    }
  }, [data, isDark])

  return <ReactECharts option={option} style={{ height: 260 }} notMerge lazyUpdate />
}
