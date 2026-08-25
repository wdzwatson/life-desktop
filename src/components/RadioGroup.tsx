import { useId, type ReactNode } from 'react'

export type RadioOption = {
  value: string
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  tone?: 'default' | 'danger'
}

type RadioGroupProps = {
  name?: string
  value: string
  options: RadioOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function RadioGroup({ name, value, options, onValueChange, disabled = false, className }: RadioGroupProps) {
  const generatedName = useId()

  return (
    <div className={['radio-group', className].filter(Boolean).join(' ')} role="radiogroup">
      {options.map((option) => {
        const optionDisabled = disabled || option.disabled
        const selected = option.value === value
        return (
          <label
            key={option.value}
            className={[
              'radio-group__option',
              selected ? 'is-selected' : '',
              option.tone === 'danger' ? 'is-danger' : '',
              optionDisabled ? 'is-disabled' : '',
            ].filter(Boolean).join(' ')}
          >
            <input
              type="radio"
              className="radio-group__input"
              name={name ?? generatedName}
              value={option.value}
              checked={selected}
              disabled={optionDisabled}
              onChange={() => onValueChange(option.value)}
            />
            <span className="radio-group__indicator" aria-hidden="true" />
            <span className="radio-group__copy">
              <strong>{option.label}</strong>
              {option.description && <small>{option.description}</small>}
            </span>
          </label>
        )
      })}
    </div>
  )
}
