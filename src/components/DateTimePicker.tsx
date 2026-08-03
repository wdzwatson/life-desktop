import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type AriaAttributes,
  type MouseEventHandler,
} from 'react'
import { CalendarDays, Clock3, X } from 'lucide-react'
import { TimePickerTime } from '@uiw/react-time-picker/esm/Time'
import ReactDatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import './DateTimePicker.css'

export type DateTimePickerMode = 'date' | 'date-time' | 'time'

type DateTimePickerProps = {
  ariaDescribedBy?: string
  ariaInvalid?: AriaAttributes['aria-invalid']
  ariaLabel: string
  className?: string
  clearable?: boolean
  disabled?: boolean
  locale?: string
  minDate?: Date
  mode?: DateTimePickerMode
  onChange: (date: Date | null) => void
  onInputClick?: () => void
  placeholder?: string
  popperPlacement?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'
  portalId?: string
  timeInputLabel?: string
  value: Date | null
}

type PickerTriggerProps = {
  className?: string
  clearable?: boolean
  mode: DateTimePickerMode
  onClick?: MouseEventHandler<HTMLButtonElement>
  onClear?: () => void
  placeholder?: string
  value?: string
  'aria-describedby'?: string
  'aria-invalid'?: AriaAttributes['aria-invalid']
  'aria-label'?: string
}

const PickerTrigger = forwardRef<HTMLButtonElement, PickerTriggerProps>(function PickerTrigger(
  { className, clearable = false, mode, onClick, onClear, placeholder, value, ...ariaProps },
  ref,
) {
  const Icon = mode === 'time' ? Clock3 : CalendarDays

  return (
    <span className="date-time-picker__trigger-wrap">
      <button
        ref={ref}
        type="button"
        className={`date-time-picker__trigger ${clearable ? 'date-time-picker__trigger--clearable' : ''} ${className ?? ''}`}
        onClick={onClick}
        {...ariaProps}
      >
        <Icon size={15} aria-hidden="true" />
        <span>{value || placeholder}</span>
      </button>
      {clearable && value && (
        <button
          type="button"
          className="date-time-picker__clear"
          aria-label="Clear value"
          title="Clear value"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClear?.()
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </span>
  )
})

function getDateFormat(mode: DateTimePickerMode) {
  if (mode === 'time') return 'HH:mm'
  return mode === 'date-time' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd'
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

type CalendarTimeInputProps = {
  ariaLabel?: string
  displayAsField?: boolean
  onChange?: (value: string) => void
  value?: string
}

function CalendarTimeInput({
  ariaLabel,
  displayAsField = false,
  onChange,
  value = '',
}: CalendarTimeInputProps) {
  const [isTimePickerOpen, setIsTimePickerOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement | null>(null)
  const selectedTime = timeValueToDate(value) ?? new Date(2000, 0, 1, 0, 0)

  useEffect(() => {
    if (!isTimePickerOpen) return

    const closeTimePickerOnOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) {
        setIsTimePickerOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeTimePickerOnOutsidePointerDown, true)
    return () =>
      document.removeEventListener('pointerdown', closeTimePickerOnOutsidePointerDown, true)
  }, [isTimePickerOpen])

  const handleTimeSelected = (
    _type: 'Hours' | 'Minutes' | 'Seconds' | undefined,
    _value: number,
    _disabledValues: number[],
    nextTime: Date | undefined,
  ) => {
    if (!nextTime) return
    onChange?.(formatTimeValue(nextTime))
    setIsTimePickerOpen(false)
  }

  if (displayAsField) {
    return (
      <div ref={controlRef} className="date-time-picker__time-control" aria-label={ariaLabel}>
        <button
          type="button"
          className="date-time-picker__time-input"
          aria-expanded={isTimePickerOpen}
          onClick={() => setIsTimePickerOpen((isOpen) => !isOpen)}
        >
          <Clock3 size={14} aria-hidden="true" />
          <span>{formatTimeValue(selectedTime)}</span>
        </button>
        {isTimePickerOpen && (
          <div className="date-time-picker__time-dropdown">
            <TimePickerTime
              date={selectedTime}
              precision="minute"
              onSelected={handleTimeSelected}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="date-time-picker__time-panel" aria-label={ariaLabel}>
      <TimePickerTime date={selectedTime} precision="minute" onSelected={handleTimeSelected} />
    </div>
  )
}

/** Shared date, date-time and time picker with a consistent desktop popover. */
export const DateTimePicker = forwardRef<ReactDatePicker, DateTimePickerProps>(
  function DateTimePicker(
    {
      ariaDescribedBy,
      ariaInvalid,
      ariaLabel,
      className,
      clearable = false,
      disabled = false,
      locale,
      minDate,
      mode = 'date',
      onChange,
      onInputClick,
      placeholder,
      popperPlacement = 'bottom-start',
      portalId,
      timeInputLabel = 'Time',
      value,
    },
    ref,
  ) {
    const hasTime = mode !== 'date'
    const datePickerRef = useRef<ReactDatePicker | null>(null)

    const setDatePickerRef = (instance: ReactDatePicker | null) => {
      datePickerRef.current = instance
      if (typeof ref === 'function') ref(instance)
      else if (ref) ref.current = instance
    }

    return (
      <ReactDatePicker
        ref={setDatePickerRef}
        selected={isValidDate(value) ? value : null}
        onChange={onChange}
        onInputClick={onInputClick}
        dateFormat={getDateFormat(mode)}
        disabled={disabled}
        isClearable={false}
        locale={locale}
        minDate={isValidDate(minDate) ? minDate : undefined}
        wrapperClassName="date-time-picker"
        popperClassName={`date-time-picker__popper date-time-picker__popper--${mode}`}
        popperPlacement={popperPlacement}
        portalId={portalId}
        showTimeInput={hasTime}
        timeFormat="HH:mm"
        timeCaption=""
        timeInputLabel=""
        timeIntervals={1}
        customTimeInput={
          <CalendarTimeInput ariaLabel={timeInputLabel} displayAsField={mode === 'date-time'} />
        }
        customInput={
          <PickerTrigger
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            className={className}
            clearable={clearable}
            mode={mode}
            onClear={() => {
              onChange(null)
              datePickerRef.current?.setOpen(false)
            }}
            placeholder={placeholder}
          />
        }
      />
    )
  },
)

DateTimePicker.displayName = 'DateTimePicker'

type TimePickerProps = Omit<DateTimePickerProps, 'mode' | 'onChange' | 'value'> & {
  onChange: (value: string) => void
  value: string
}

function timeValueToDate(value: string): Date | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes)
}

function formatTimeValue(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

export const TimePicker = forwardRef<ReactDatePicker, TimePickerProps>(function TimePicker(
  { onChange, value, ...props },
  ref,
) {
  return (
    <DateTimePicker
      {...props}
      ref={ref}
      mode="time"
      value={timeValueToDate(value)}
      onChange={(date) => onChange(date ? formatTimeValue(date) : '')}
    />
  )
})

TimePicker.displayName = 'TimePicker'
