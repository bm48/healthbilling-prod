import { getYearMonthFromStoredDate } from '@/lib/utils'
import type { AccountsReceivable } from '@/types'

/** Fields used to decide if a row belongs to the A-R month view (same as AccountsReceivableTab). */
export type AccountsReceivableMonthMatchInput = Pick<
  AccountsReceivable,
  'id' | 'created_at' | 'date_of_service' | 'date_recorded' | 'ar_year' | 'ar_month'
>

/**
 * Legacy inference when `ar_year` / `ar_month` are missing (e.g. old backups). Prefer service/record dates, then created_at.
 */
export function inferAccountsReceivableSheetYearMonth(
  ar: Pick<AccountsReceivable, 'created_at' | 'date_of_service' | 'date_recorded'>
): { year: number; month: number } | null {
  const dos = ar.date_of_service != null && String(ar.date_of_service) !== 'null' ? String(ar.date_of_service) : null
  const dr = ar.date_recorded != null && String(ar.date_recorded) !== 'null' ? String(ar.date_recorded) : null
  const fromDate = getYearMonthFromStoredDate(dos || dr)
  if (fromDate) return { year: fromDate.year, month: fromDate.month }
  const ca =
    ar.created_at != null && ar.created_at !== '' && String(ar.created_at) !== 'null' ? String(ar.created_at) : null
  const fromCreated = getYearMonthFromStoredDate(ca)
  if (fromCreated) return { year: fromCreated.year, month: fromCreated.month }
  return null
}

function legacyIsAccountsReceivableRowInMonth(
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

/**
 * Whether an accounts receivable row belongs in the selected month’s A-R sheet.
 * Uses persisted `ar_year` / `ar_month` (sheet month selector). Falls back to legacy date rules only when those are absent.
 */
export function isAccountsReceivableRowInMonth(
  ar: AccountsReceivableMonthMatchInput,
  monthDate: Date
): boolean {
  const y = ar.ar_year
  const m = ar.ar_month
  if (y != null && m != null && Number.isFinite(Number(y)) && Number.isFinite(Number(m))) {
    return Number(y) === monthDate.getFullYear() && Number(m) === monthDate.getMonth() + 1
  }
  return legacyIsAccountsReceivableRowInMonth(ar, monthDate)
}
