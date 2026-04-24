import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'
import type { DailyBySourcePoint } from '@/lib/aggregations'
import { SOURCE_COLOR, SOURCE_LABEL } from '@/lib/aggregations'
import { formatCompact } from '@/lib/format'
import { useSettings } from '@/stores/settings'
import type { AgentSource } from '@/types/api'

interface Props {
  data: DailyBySourcePoint[]
}

export function StackedSourceChart({ data }: Props) {
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
    const sources: AgentSource[] = ['claude-code', 'codex', 'unknown']
    // 隐藏始终为 0 的来源系列
    const present = sources.filter((s) => data.some((d) => d.bySource[s] > 0))

    return {
      grid: { left: 50, right: 24, top: 32, bottom: 28 },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: isDark ? '#cbd5e1' : '#475569', fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
        icon: 'circle',
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#0f172a' : '#ffffff',
        borderColor: isDark ? '#1e293b' : '#e2e8f0',
        textStyle: { color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9', type: 'dashed' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: (v: number) => formatCompact(v) },
      },
      series: present.map((s) => ({
        name: SOURCE_LABEL[s],
        type: 'line',
        stack: 'sources',
        smooth: true,
        showSymbol: false,
        data: data.map((d) => d.bySource[s]),
        lineStyle: { width: 1.5, color: SOURCE_COLOR[s] },
        itemStyle: { color: SOURCE_COLOR[s] },
        areaStyle: { color: SOURCE_COLOR[s], opacity: 0.55 },
      })),
    }
  }, [data, isDark])

  return <ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />
}
