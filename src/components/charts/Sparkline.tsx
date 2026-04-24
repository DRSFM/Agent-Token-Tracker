// 极小的内联 SVG 折线图 — 不引 echarts，避免多实例开销
import { cn } from '@/lib/utils'

interface Props {
  data: number[]
  width?: number
  height?: number
  color?: string
  strokeWidth?: number
  fill?: boolean
  className?: string
}

export function Sparkline({
  data,
  width = 96,
  height = 28,
  color = '#3b82f6',
  strokeWidth = 1.5,
  fill = true,
  className,
}: Props) {
  if (!data.length) return <div style={{ width, height }} />
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const span = max - min || 1
  const stepX = data.length > 1 ? width / (data.length - 1) : 0
  const points = data.map((v, i) => {
    const x = i * stepX
    const y = height - ((v - min) / span) * height
    return [x, y]
  })
  const path = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ')
  const area = `${path} L${width} ${height} L0 ${height} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
    >
      {fill && <path d={area} fill={color} fillOpacity={0.12} />}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
