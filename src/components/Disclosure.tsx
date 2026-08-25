import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

type DisclosureProps = {
  title: ReactNode
  children: ReactNode
  className?: string
  defaultOpen?: boolean
}

export function Disclosure({ title, children, className, defaultOpen = false }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()
  return (
    <div className={['disclosure', open ? 'is-open' : '', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="disclosure__trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        {title}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && <div id={contentId} className="disclosure__content">{children}</div>}
    </div>
  )
}
