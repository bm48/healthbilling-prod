import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '$0.00'
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(numAmount)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(numAmount)
}

export function formatDate(date: string | null | undefined): string {
  if (date == null || date === '') return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(date: string | null | undefined): string {
  if (date == null || date === '') return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format date for table cells as MM-DD-YY (e.g. 01-05-25). Returns '' for empty/invalid. */
export function toDisplayDate(value: string | null | undefined): string {
  if (value == null || value === '' || value === 'null') return ''
  const s = String(value).trim()
  // Parse YYYY-MM-DD as date-only (no timezone): avoid new Date() which treats it as UTC and shifts day in local TZ
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) {
    const [, yyyy, mm, dd] = iso
    if (mm && dd) return `${mm}-${dd}-${yyyy!.slice(-2)}`
  }
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${mm}-${dd}-${yy}`
}

/**
 * Format raw input (digits + optional dashes) as MM-DD-YY while typing.
 * e.g. "03", "031", "0311", "03112", "031125" -> "03", "03-1", "03-11", "03-11-2", "03-11-25"
 * If 8 digits (YYYYMMDD) pasted, treats as YYYY-MM-DD and returns MM-DD-YY.
 */
export function formatDateOfServiceAsYouType(input: string | null | undefined): string {
  if (input == null) return ''
  const digits = String(input).replace(/\D/g, '')
  if (digits.length === 0) return ''
  let mm: string, dd: string, yy: string
  if (digits.length >= 8) {
    mm = digits.slice(2, 4)
    dd = digits.slice(4, 6)
    yy = digits.slice(6, 8)
  } else {
    mm = digits.slice(0, 2)
    dd = digits.slice(2, 4)
    yy = digits.slice(4, 6)
  }
  const parts: string[] = [mm]
  if (dd.length) parts.push(dd)
  if (yy.length) parts.push(yy)
  return parts.join('-')
}

/** Calendar check in UTC so YYYY-MM-DD parses consistently (no local-TZ drift). */
function isValidCalendarYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const t = Date.UTC(year, month - 1, day)
  const dt = new Date(t)
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

/**
 * Parse user/table input to YYYY-MM-DD for Postgres `date` columns.
 * Accepts YYYY-MM-DD, MM-DD-YY, MM-DD-YYYY (slashes OK: normalized to dashes).
 * Returns null for empty input, partial typing ("11", "03-11"), garbage, or impossible dates.
 */
export function parseDateOfServiceInput(value: string | null | undefined): string | null {
  if (value == null || value === '' || value === 'null') return null
  let s = String(value).trim()
  if (!s) return null
  s = s.replace(/\//g, '-')

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) {
    const y = parseInt(iso[1]!, 10)
    const mo = parseInt(iso[2]!, 10)
    const d = parseInt(iso[3]!, 10)
    if (!isValidCalendarYmd(y, mo, d)) return null
    return s
  }

  // MM-DD-YY or MM-DD-YYYY (full date only — never pass through partial strings)
  const match = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/)
  if (!match) return null

  const month = parseInt(match[1]!, 10)
  const day = parseInt(match[2]!, 10)
  const yyPart = match[3]!
  let year: number
  if (yyPart.length === 2) {
    const y = parseInt(yyPart, 10)
    year = y >= 0 && y <= 99 ? 2000 + y : y
  } else {
    year = parseInt(yyPart, 10)
  }

  if (!isValidCalendarYmd(year, month, day)) return null
  const yyyy = String(year)
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  return `${yyyy}-${m}-${d}`
}

/**
 * Calendar year + month (1–12) from a stored DB/date string, without UTC midnight shift on `YYYY-MM-DD`.
 * Use for month bucketing (e.g. AR tab filters); avoids `new Date('2021-11-11')` showing as prior day in US TZ.
 */
export function getYearMonthFromStoredDate(dateStr: string | null | undefined): { year: number; month: number } | null {
  if (dateStr == null || dateStr === '' || dateStr === 'null') return null
  const s = String(dateStr).trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) {
    const year = parseInt(iso[1]!, 10)
    const month = parseInt(iso[2]!, 10)
    if (month < 1 || month > 12) return null
    return { year, month }
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/** Use for table cell display: never show the literal "null" or null/undefined. */
export function toDisplayValue(value: string | number | null | undefined): string {
  if (value == null || value === '' || value === 'null') return ''
  if (typeof value === 'number' && Number.isNaN(value)) return ''
  return String(value)
}

/** Use when storing optional string fields: treat '' and string 'null' as null. */
export function toStoredString(value: string | null | undefined): string | null {
  if (value === '' || value === 'null') return null
  return value ?? null
}
