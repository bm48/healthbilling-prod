import { getYearMonthFromStoredDate } from '@/lib/utils'
import type { AccountsReceivable } from '@/types'

/** Fields used to decide if a row belongs to the A-R month view (same as AccountsReceivableTab). */
export type AccountsReceivableMonthMatchInput = Pick<
  AccountsReceivable,
  'id' | 'created_at' | 'date_of_service' | 'date_recorded'
>

/**
 * Whether an accounts receivable row belongs in the selected month’s A-R sheet.
 * Matches AccountsReceivableTab `isARInMonth` so billing sheet “AR Total” matches the A-R tab total.
 */
export function isAccountsReceivableRowInMonth(
  ar: AccountsReceivableMonthMatchInput,
  monthDate: Date
): boolean {
  const targetMonth = monthDate.getMonth() + 1
  const targetYear = monthDate.getFullYear()
  const now = new Date()
  const isCurrentMonth = monthDate.getMonth() === now.getMonth() && targetYear === now.getFullYear()
  if (ar.id.startsWith('empty-') || ar.id.startsWith('new-')) {
    const hasDate = !!(ar.date_of_service || ar.date_recorded)
    if (hasDate) {
      const d = ar.date_of_service || ar.date_recorded
      const ym = getYearMonthFromStoredDate(d ? String(d) : null)
      if (ym) return ym.year === targetYear && ym.month === targetMonth
      return false
    }
    return true
  }
  const createdYm = getYearMonthFromStoredDate(
    ar.created_at != null && ar.created_at !== '' && ar.created_at !== 'null' ? String(ar.created_at) : null
  )
  if (createdYm && createdYm.year === targetYear && createdYm.month === targetMonth) {
    return true
  }
  const dateStr = ar.date_of_service || ar.date_recorded
  if (!dateStr) return isCurrentMonth
  const ym = getYearMonthFromStoredDate(String(dateStr))
  if (!ym) return isCurrentMonth
  return ym.year === targetYear && ym.month === targetMonth
}
