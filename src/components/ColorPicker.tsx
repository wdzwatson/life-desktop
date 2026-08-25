import { useRef, type CSSProperties } from 'react'
import { Palette } from 'lucide-react'

type ColorPickerProps = {
  value: string
  onChange: (value: string) => void
  label: string
  title?: string
  className?: string
  style?: CSSProperties
  disabled?: boolean
  onOpen?: () => void
}

export function ColorPicker({ value, onChange, label, title, className, style, disabled = false, onOpen }: ColorPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <span className={['color-picker', className].filter(Boolean).join(' ')} style={style}>
      <button
        type="button"
        className="color-picker__trigger"
        aria-label={label}
        title={title ?? label}
        disabled={disabled}
        onClick={() => {
          onOpen?.()
          inputRef.current?.click()
        }}
      >
        <span className="color-picker__swatch" style={{ backgroundColor: value }} aria-hidden="true" />
        <Palette size={14} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        className="color-picker__native"
        type="color"
        value={value}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  )
}
