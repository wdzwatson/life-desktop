import { forwardRef, type ChangeEventHandler, type CSSProperties, type InputHTMLAttributes } from 'react'

export type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'style' | 'type'> & {
  className?: string
  style?: CSSProperties
  type?: 'range'
  onChange?: ChangeEventHandler<HTMLInputElement>
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { className, disabled, max = 100, min = 0, style, value, ...inputProps },
  ref,
) {
  const numericMin = Number(min)
  const numericMax = Number(max)
  const numericValue = Number(value ?? numericMin)
  const percentage = numericMax > numericMin
    ? Math.max(0, Math.min(100, ((numericValue - numericMin) / (numericMax - numericMin)) * 100))
    : 0

  return (
    <span className={['slider', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')} style={style}>
      <input
        {...inputProps}
        ref={ref}
        className="slider__input"
        type="range"
        disabled={disabled}
        max={max}
        min={min}
        value={value}
      />
      <span className="slider__track" aria-hidden="true">
        <span className="slider__fill" style={{ width: `${percentage}%` }} />
        <span className="slider__thumb" style={{ left: `${percentage}%` }} />
      </span>
    </span>
  )
})

Slider.displayName = 'Slider'
