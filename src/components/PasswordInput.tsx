import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  hideLabel: string
  showLabel: string
}

export function PasswordInput({
  className,
  hideLabel,
  showLabel,
  ...inputProps
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false)
  const label = isVisible ? hideLabel : showLabel

  return (
    <div className="password-input">
      <input {...inputProps} className={className} type={isVisible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-input__toggle"
        aria-label={label}
        title={label}
        onClick={() => setIsVisible((visible) => !visible)}
      >
        {isVisible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}
