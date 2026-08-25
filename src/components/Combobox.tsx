import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type ComboboxOption = { value: string; label: string; description?: string }

type ComboboxProps = {
  value: string
  options: ComboboxOption[]
  onValueChange: (value: string) => void
  className?: string
  style?: CSSProperties
  placeholder?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  autoComplete?: string
  list?: string
  disabled?: boolean
}

export function Combobox({ value, options, onValueChange, className, style, placeholder, ariaLabel, ariaDescribedBy, autoComplete, list, disabled = false }: ComboboxProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase()
    return query ? options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query)) : options
  }, [options, value])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  return (
    <div ref={rootRef} className={['combobox', className].filter(Boolean).join(' ')} style={style}>
      <div className={`combobox__control${open ? ' is-open' : ''}`}>
        <input
          className="combobox__input"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-describedby={ariaDescribedBy}
          autoComplete={autoComplete}
          list={list}
          aria-label={ariaLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onValueChange(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
            if (event.key === 'ArrowDown') setOpen(true)
          }}
        />
        <button type="button" className="combobox__trigger" disabled={disabled} aria-label="Toggle options" onClick={() => setOpen((current) => !current)}>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
      {open && !disabled && (
        <div id={listId} className="combobox__menu" role="listbox">
          {filteredOptions.length === 0 ? (
            <div className="combobox__empty">No options</div>
          ) : filteredOptions.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`combobox__option${option.value === value ? ' is-selected' : ''}`}
              key={option.value}
              onClick={() => {
                onValueChange(option.value)
                setOpen(false)
              }}
            >
              <span>
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
