type ProgressBarProps = {
  value?: number
  max?: number
  label?: string
  className?: string
  indeterminate?: boolean
}

export function ProgressBar({ value = 0, max = 100, label, className, indeterminate = false }: ProgressBarProps) {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div
      className={['progress-bar', indeterminate ? 'is-indeterminate' : '', className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
    >
      <span className="progress-bar__fill" style={indeterminate ? undefined : { width: `${percentage}%` }} />
    </div>
  )
}
