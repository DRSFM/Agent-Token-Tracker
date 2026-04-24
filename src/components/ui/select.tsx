import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'

interface Option {
  label: string
  value: string
}

interface Props extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: Option[]
  value: string
  onChange: (v: string) => void
}

export function Select({ options, value, onChange, className, ...rest }: Props) {
  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'appearance-none pl-3 pr-8 py-1.5 rounded-lg text-xs font-medium',
          'bg-slate-100/80 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200',
          'border border-transparent hover:border-slate-300 dark:hover:border-slate-700',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/40',
          'cursor-pointer transition',
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 w-3.5 h-3.5 pointer-events-none text-slate-400" />
    </div>
  )
}
