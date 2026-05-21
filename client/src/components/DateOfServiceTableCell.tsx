import { useEffect, useState } from 'react'
import {
  formatDateOfServiceAsYouType,
  parseDateOfServiceInput,
  toDisplayDate,
} from '@/lib/utils'

type Props = {
  /** Stored value (YYYY-MM-DD or ISO from Postgres). */
  value: string | null
  onCommit: (stored: string | null) => void | Promise<void>
  disabled?: boolean
}

/** Table cell editor matching billing sheet Date of Service (MM-DD-YY, digits + dashes). */
export function DateOfServiceTableCell({ value, onCommit, disabled }: Props) {
  const [draft, setDraft] = useState(() => toDisplayDate(value))

  useEffect(() => {
    setDraft(toDisplayDate(value))
  }, [value])

  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      placeholder="MM-DD-YY"
      onChange={(e) => setDraft(formatDateOfServiceAsYouType(e.target.value))}
      onBlur={() => {
        const stored = parseDateOfServiceInput(draft)
        void onCommit(stored)
        setDraft(stored != null ? toDisplayDate(stored) : toDisplayDate(value))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
