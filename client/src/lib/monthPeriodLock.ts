/**
 * Compare viewed clinic month/payroll to "now" for past-period sheet lock.
 * Payroll 2: first half = calendar days 1–15, second half = 16–end (matches typical pay-period UX).
 */
export function getCurrentPeriod(clinicPayroll: 1 | 2): { y: number; m: number; p: 1 | 2 } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (clinicPayroll === 1) {
    return { y, m, p: 1 }
  }
  const day = now.getDate()
  const p: 1 | 2 = day <= 15 ? 1 : 2
  return { y, m, p }
}

export function isPastPeriod(
  viewYear: number,
  viewMonth: number,
  viewPayroll: 1 | 2,
  clinicPayroll: 1 | 2
): boolean {
  const cur = getCurrentPeriod(clinicPayroll)
  if (clinicPayroll === 1) {
    return viewYear < cur.y || (viewYear === cur.y && viewMonth < cur.m)
  }
  if (viewYear < cur.y) return true
  if (viewYear > cur.y) return false
  if (viewMonth < cur.m) return true
  if (viewMonth > cur.m) return false
  return viewPayroll < cur.p
}

/** Month key as used in app: "YYYY-M" or "YYYY-M-P" when payroll=2. */
export function isPastPeriodFromMonthKey(monthKey: string, clinicPayroll: 1 | 2): boolean {
  const parts = monthKey.split('-').map((x) => parseInt(x, 10))
  if (parts.length < 2 || Number.isNaN(parts[0]!) || Number.isNaN(parts[1]!)) return false
  const y = parts[0]!
  const m = parts[1]!
  const p: 1 | 2 = clinicPayroll === 2 && parts.length >= 3 && parts[2] === 2 ? 2 : 1
  return isPastPeriod(y, m, p, clinicPayroll)
}
