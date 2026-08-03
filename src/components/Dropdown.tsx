import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useMemo,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { ChevronDown } from 'lucide-react'
import Select, {
  components,
  type GroupBase,
  type MultiValue,
  type SingleValue,
  type SelectInstance,
} from 'react-select'

export type DropdownOption = {
  value: string | number
  label: ReactNode
  disabled?: boolean
  icon?: ReactNode
  description?: ReactNode
  searchText?: string
}

export type DropdownGroup = GroupBase<DropdownOption> & {
  label: string
  options: DropdownOption[]
}

type DropdownValue = string | number | readonly (string | number)[] | null | undefined

type NativeSelectProps = Pick<
  ComponentPropsWithoutRef<'select'>,
  | 'aria-label'
  | 'aria-labelledby'
  | 'autoFocus'
  | 'defaultValue'
  | 'disabled'
  | 'id'
  | 'name'
  | 'required'
  | 'tabIndex'
  | 'title'
>

type OptionElementProps = {
  children?: ReactNode
  disabled?: boolean
  value?: string | number
}

type OptionGroupElementProps = {
  children?: ReactNode
  label?: string
}

export type DropdownProps = NativeSelectProps & {
  children?: ReactNode
  className?: string
  clearable?: boolean
  controlHeight?: CSSProperties['height']
  icon?: ReactNode
  menuGap?: number
  multiple?: boolean
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void
  onValueChange?: (value: string | string[]) => void
  options?: Array<DropdownOption | DropdownGroup>
  searchable?: boolean
  style?: CSSProperties
  value?: DropdownValue
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join(' ')
  if (isValidElement(node)) return textFromNode((node.props as OptionElementProps).children)
  return ''
}

function readOptions(children: ReactNode): Array<DropdownOption | DropdownGroup> {
  const entries: Array<DropdownOption | DropdownGroup> = []

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return

    if (child.type === Fragment) {
      entries.push(...readOptions((child.props as OptionElementProps).children))
      return
    }

    if (child.type === 'optgroup') {
      const groupProps = child.props as OptionGroupElementProps
      entries.push({
        label: String(groupProps.label ?? ''),
        options: readOptions(groupProps.children).filter(
          (option): option is DropdownOption => !('options' in option),
        ),
      })
      return
    }

    if (child.type !== 'option') return

    const optionProps = child.props as OptionElementProps
    entries.push({
      value: String(optionProps.value ?? textFromNode(optionProps.children)),
      label: optionProps.children,
      disabled: Boolean(optionProps.disabled),
    })
  })

  return entries
}

function flattenOptions(entries: Array<DropdownOption | DropdownGroup>): DropdownOption[] {
  return entries.flatMap((entry) => ('options' in entry ? entry.options : [entry]))
}

function toCssDimension(value: CSSProperties['height'] | undefined): string {
  if (typeof value === 'number') return `${value}px`
  return value ?? '36px'
}

/**
 * A desktop-friendly select built on react-select. It supports searchable,
 * grouped and multi-value menus while accepting legacy option children.
 */
export const Dropdown = forwardRef<SelectInstance<DropdownOption, boolean, DropdownGroup>, DropdownProps>(
  function Dropdown(
    {
      children,
      className,
      clearable = false,
      controlHeight,
      defaultValue,
      disabled,
      icon,
      menuGap = 6,
      multiple = false,
      onChange,
      onValueChange,
      options,
      searchable = true,
      style,
      value,
      ...selectProps
    },
    ref,
  ) {
    const dropdownOptions = useMemo(() => options ?? readOptions(children), [children, options])
    const flatOptions = useMemo(() => flattenOptions(dropdownOptions), [dropdownOptions])
    const resolvedControlHeight = toCssDimension(controlHeight ?? style?.height)
    const resolvedValue = value ?? defaultValue
    const selectedValues = useMemo(
      () => new Set((Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]).filter((item) => item != null).map(String)),
      [resolvedValue],
    )
    const selected = multiple
      ? flatOptions.filter((option) => selectedValues.has(String(option.value)))
      : flatOptions.find((option) => selectedValues.has(String(option.value))) ?? null

    const emitChange = (selection: MultiValue<DropdownOption> | SingleValue<DropdownOption>) => {
      const selectedOptions = Array.isArray(selection) ? [...selection] : selection ? [selection] : []
      const values = selectedOptions.map((option) => String(option.value))
      const nextValue = multiple ? values : values[0] ?? ''

      onValueChange?.(nextValue)
      onChange?.({
        target: { value: values[0] ?? '', selectedOptions },
        currentTarget: { value: values[0] ?? '', selectedOptions },
      } as unknown as ChangeEvent<HTMLSelectElement>)
    }

    return (
      <Select<DropdownOption, boolean, DropdownGroup>
        ref={ref}
        className={['dropdown', className].filter(Boolean).join(' ')}
        classNamePrefix="dropdown"
        closeMenuOnSelect={!multiple}
        components={{
          Control: (props) => (
            <components.Control {...props}>
              {icon && <span className="dropdown__control-icon">{icon}</span>}
              {props.children}
            </components.Control>
          ),
          DropdownIndicator: () => (
            <span className="dropdown__indicator" aria-hidden="true">
              <ChevronDown size={16} strokeWidth={2} />
            </span>
          ),
          IndicatorSeparator: () => null,
        }}
        formatOptionLabel={(option, { context }) => (
          <span className={`dropdown__option-content dropdown__option-content--${context}`}>
            {option.icon && <span className="dropdown__option-icon">{option.icon}</span>}
            <span className="dropdown__option-copy">
              <span>{option.label}</span>
              {context === 'menu' && option.description && <small>{option.description}</small>}
            </span>
          </span>
        )}
        getOptionLabel={(option) => option.searchText ?? textFromNode(option.label)}
        getOptionValue={(option) => String(option.value)}
        isClearable={clearable}
        isDisabled={disabled}
        isMulti={multiple}
        isOptionDisabled={(option) => Boolean(option.disabled)}
        isSearchable={searchable}
        menuPlacement="auto"
        menuPortalTarget={typeof document === 'undefined' ? undefined : document.body}
        menuPosition="fixed"
        noOptionsMessage={() => 'No options'}
        onChange={emitChange}
        options={dropdownOptions}
        placeholder=""
        styles={{
          container: (base) => ({
            ...base,
            ...style,
            '--dropdown-height': resolvedControlHeight,
          }),
          control: (base) => ({
            ...base,
            minHeight: 'var(--dropdown-height)',
            height: 'var(--dropdown-height)',
          }),
          menu: (base) => ({ ...base, marginTop: menuGap }),
          menuPortal: (base) => ({ ...base, zIndex: 10000 }),
        }}
        unstyled
        value={selected}
        {...selectProps}
      />
    )
  },
)

Dropdown.displayName = 'Dropdown'
