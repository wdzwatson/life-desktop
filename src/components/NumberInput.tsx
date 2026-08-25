import { forwardRef, useEffect, useState, type CSSProperties, type InputHTMLAttributes } from 'react'
import { Minus, Plus } from 'lucide-react'

export type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'style' | 'type' | 'value' | 'defaultValue' | 'onChange'
> & {
  className?: string
  style?: CSSProperties
  value?: number | string
  defaultValue?: number | string
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  onValueChange?: (value: string) => void
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { className, defaultValue = '', disabled, max, min, onChange, onValueChange, step = 1, style, value, ...inputProps },
  forwardedRef,
) {
  const [internalValue, setInternalValue] = useState(String(value ?? defaultValue))
  const isControlled = value !== undefined
  const currentValue = isControlled ? String(value) : internalValue

  useEffect(() => {
    if (isControlled) setInternalValue(String(value))
  }, [isControlled, value])

  const emitValue = (nextValue: string) => {
    if (!isControlled) setInternalValue(nextValue)
    onValueChange?.(nextValue)
  }

  const stepValue = (direction: 1 | -1) => {
    const current = Number(currentValue)
    const parsedStep = Number(step) || 1
    const base = Number.isFinite(current) ? current : Number(min ?? 0)
    const next = base + direction * parsedStep
    const bounded = Math.max(Number(min ?? -Infinity), Math.min(Number(max ?? Infinity), next))
    const precision = String(parsedStep).includes('.') ? String(parsedStep).split('.')[1].length : 0
    emitValue(precision ? bounded.toFixed(precision) : String(bounded))
  }

  return (
    <span className={['number-input', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')} style={style}>
      <input
        {...inputProps}
        ref={forwardedRef}
        className="number-input__field"
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        type="number"
        value={currentValue}
        onChange={(event) => {
          emitValue(event.target.value)
          onChange?.(event)
        }}
      />
      <span className="number-input__controls">
        <button type="button" className="number-input__button" disabled={disabled} onClick={() => stepValue(1)} aria-label="Increase value">
          <Plus size={12} aria-hidden="true" />
        </button>
        <button type="button" className="number-input__button" disabled={disabled} onClick={() => stepValue(-1)} aria-label="Decrease value">
          <Minus size={12} aria-hidden="true" />
        </button>
      </span>
    </span>
  )
})

NumberInput.displayName = 'NumberInput'
