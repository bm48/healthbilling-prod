import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Returns `#000` for light backgrounds and `#fff` for dark ones using the WCAG relative-luminance
 *  formula. Accepts `#rgb`, `#rrggbb`, or `rgb()/rgba()`; falls back to white for unknown formats. */
export function readableTextColor(bg: string): '#000000' | '#ffffff' {
  if (!bg) return '#ffffff'
  let r = 0, g = 0, b = 0
  const hex = bg.trim().match(/^#?([a-f0-9]{6}|[a-f0-9]{3})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    r = parseInt(h.slice(0, 2), 16)
    g = parseInt(h.slice(2, 4), 16)
    b = parseInt(h.slice(4, 6), 16)
  } else {
    const rgb = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
    if (!rgb) return '#ffffff'
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3])
  }
  const srgb = [r, g, b].map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  })
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
  return L > 0.5 ? '#000000' : '#ffffff'
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
  // YYYY-MM-DD or PostgREST ISO (`YYYY-MM-DDTHH:mm:ss.sssZ`) — use calendar date part only (no TZ shift)
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ].*)?$/.exec(s)
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
 * Format raw input as MM-DD-YY while typing.
 * - Separators (`/`, `-`, `.`, space) are treated as segment hints so "6/9/25" stays "6-9-25"
 *   instead of collapsing to "69-25". But once a segment overflows its cap (2 digits for MM/DD,
 *   4 for YYYY), the extra digits spill into the next segment — otherwise typing "060925"
 *   without dashes would stall at "06-09" and silently drop DD/YY.
 * - Pure digit input auto-positions: "060925" → "06-09-25". An 8-digit blob is YYYYMMDD.
 */
export function formatDateOfServiceAsYouType(input: string | null | undefined): string {
  if (input == null) return ''
  const raw = String(input)
  if (raw.length === 0) return ''
  const hasSeparator = /[\/\-.\s]/.test(raw)
  let mm: string
  let dd: string
  let yy: string
  if (hasSeparator) {
    const segs = raw.split(/[\/\-.\s]+/).map((s) => s.replace(/\D/g, ''))
    const s0 = segs[0] ?? ''
    const s1 = segs[1] ?? ''
    const s2 = segs[2] ?? ''
    mm = s0.slice(0, 2)
    const ddPool = s0.slice(2) + s1
    dd = ddPool.slice(0, 2)
    yy = (ddPool.slice(2) + s2).slice(0, 4)
    // Preserve user-typed separator positions so "6/" renders as "6-" (cursor cue) and
    // "6/9/" renders as "6-9-", matching what the old separator branch produced.
    const typedSegs = Math.min(segs.length, 3)
    const parts: string[] = [mm]
    if (typedSegs >= 2 || dd.length) parts.push(dd)
    if (typedSegs >= 3 || yy.length) parts.push(yy)
    return parts.join('-')
  } else {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 0) return ''
    if (digits.length >= 8) {
      // YYYYMMDD → emit MM-DD-YY (mm at index 4, dd at 6, yy from last two of year)
      mm = digits.slice(4, 6)
      dd = digits.slice(6, 8)
      yy = digits.slice(2, 4)
    } else {
      mm = digits.slice(0, 2)
      dd = digits.slice(2, 4)
      yy = digits.slice(4, 6)
    }
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
 * Accepts:
 *   - YYYY-MM-DD (optional `T…` / time suffix from PostgREST)
 *   - M(M)-D(D)-YY / M(M)-D(D)-YYYY with `-`, `/`, or `.` as separator (single or double digit OK,
 *     e.g. "6/9/25" → "2025-06-09")
 *   - 6 or 8 raw digits — "060925" → "2025-06-09", "20250609" → "2025-06-09"
 * Returns null for empty input, partial typing ("11", "03-11"), garbage, or impossible dates.
 */
export function parseDateOfServiceInput(value: string | null | undefined): string | null {
  if (value == null || value === '' || value === 'null') return null
  let s = String(value).trim()
  if (!s) return null
  s = s.replace(/[\/.]/g, '-')

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[Tt ].*)?$/.exec(s)
  if (iso) {
    const y = parseInt(iso[1]!, 10)
    const mo = parseInt(iso[2]!, 10)
    const d = parseInt(iso[3]!, 10)
    if (!isValidCalendarYmd(y, mo, d)) return null
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  // US form with 1- or 2-digit month/day — covers "6-9-25", "06-09-2025", "6/9/25", "6.9.25".
  const match = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/)
  if (match) {
    const month = parseInt(match[1]!, 10)
    const day = parseInt(match[2]!, 10)
    const yyPart = match[3]!
    const year = yyPart.length === 2 ? 2000 + parseInt(yyPart, 10) : parseInt(yyPart, 10)
    if (!isValidCalendarYmd(year, month, day)) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // Raw digit blobs — 6 digits = MMDDYY (US), 8 digits = YYYYMMDD. Keeps the legacy "060925" entry
  // working and lets users paste an 8-digit ISO blob from another sheet without separators.
  const digits = s.replace(/\D/g, '')
  if (digits.length === 6) {
    const month = parseInt(digits.slice(0, 2), 10)
    const day = parseInt(digits.slice(2, 4), 10)
    const year = 2000 + parseInt(digits.slice(4, 6), 10)
    if (!isValidCalendarYmd(year, month, day)) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  if (digits.length === 8) {
    const year = parseInt(digits.slice(0, 4), 10)
    const month = parseInt(digits.slice(4, 6), 10)
    const day = parseInt(digits.slice(6, 8), 10)
    if (!isValidCalendarYmd(year, month, day)) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

/**
 * Calendar year + month (1–12) from a stored DB/date string, without UTC midnight shift on `YYYY-MM-DD`.
 * Also handles PostgREST ISO datetimes (`YYYY-MM-DDTHH:mm:ss.sssZ`) using the **date** part only.
 * Use for month bucketing (e.g. AR tab filters); avoids `new Date('2021-11-11')` showing as prior day in US TZ.
 */
export function getYearMonthFromStoredDate(dateStr: string | null | undefined): { year: number; month: number } | null {
  if (dateStr == null || dateStr === '' || dateStr === 'null') return null
  const s = String(dateStr).trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ].*)?$/.exec(s)
  if (iso) {
    const year = parseInt(iso[1]!, 10)
    const month = parseInt(iso[2]!, 10)
    const day = parseInt(iso[3]!, 10)
    if (!isValidCalendarYmd(year, month, day)) return null
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
