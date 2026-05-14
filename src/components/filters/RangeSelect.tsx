import { Select } from '@/components/ui/select'

export type RangeSelectValue = number | 'all'

const OPTIONS = [
  { value: '7', label: '最近 7 天' },
  { value: '14', label: '最近 14 天' },
  { value: '30', label: '最近 30 天' },
  { value: '60', label: '最近 60 天' },
  { value: '90', label: '最近 90 天' },
]

export function RangeSelect({
  value,
  onChange,
  options = OPTIONS,
}: {
  value: RangeSelectValue
  onChange: (value: RangeSelectValue) => void
  options?: { value: string; label: string }[]
}) {
  return (
    <Select
      value={String(value)}
      onChange={(v) => onChange(v === 'all' ? 'all' : Number(v))}
      options={options}
    />
  )
}
