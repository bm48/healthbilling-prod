import { useMemo, type ReactNode } from 'react'
import { StatusColor } from '@/types'

interface MonthYearTabsProps {
  selectedMonth: Date
  selectedPayroll?: 1 | 2
  clinicPayroll?: 1 | 2
  statusColors: StatusColor[]
  onChange: (date: Date, payroll: 1 | 2) => void
  label?: string
  isInSplitScreen?: boolean
  rightSlot?: ReactNode
  /** Rendered to the right of the colored title pill — e.g. the Select Version button. */
  labelRightSlot?: ReactNode
  /** Year dropdown starts at this year (default 2024). */
  minYear?: number
}

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f0-9]{6}|[a-f0-9]{3})$/i.exec(hex.trim())
  if (!m) return hex
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default function MonthYearTabs({
  selectedMonth,
  selectedPayroll = 1,
  clinicPayroll = 1,
  statusColors,
  onChange,
  label,
  isInSplitScreen = false,
  rightSlot,
  labelRightSlot,
  minYear = 2024,
}: MonthYearTabsProps) {
  const monthColorByName = useMemo(() => {
    const map = new Map<string, { color: string; textColor: string }>()
    for (const s of statusColors) {
      if (s.type === 'month') {
        map.set(s.status, { color: s.color, textColor: s.text_color || '#000000' })
      }
    }
    return map
  }, [statusColors])

  const currentYear = selectedMonth.getFullYear()
  const currentMonthIdx = selectedMonth.getMonth()
  const currentMonthName = MONTHS_FULL[currentMonthIdx]
  const activeColor = monthColorByName.get(currentMonthName)
  const activeBg = activeColor?.color ?? 'rgba(30, 41, 59, 0.7)'
  const activeText = activeColor?.textColor ?? '#fff'

  const yearOptions = useMemo(() => {
    const max = Math.max(new Date().getFullYear() + 1, currentYear)
    const years: number[] = []
    for (let y = minYear; y <= max; y++) years.push(y)
    if (!years.includes(currentYear)) years.unshift(currentYear)
    return years
  }, [currentYear, minYear])

  const handleYearChange = (year: number) => {
    const next = new Date(selectedMonth)
    next.setFullYear(year)
    onChange(next, selectedPayroll)
  }

  const handleMonthClick = (monthIdx: number) => {
    onChange(new Date(currentYear, monthIdx, 1), selectedPayroll)
  }

  const handlePayrollChange = (payroll: 1 | 2) => {
    onChange(selectedMonth, payroll)
  }

  const labelSuffix = clinicPayroll === 2
    ? `${currentMonthName} ${selectedPayroll === 1 ? '1st' : '2nd'} Half ${currentYear}`
    : `${currentMonthName} ${currentYear}`

  return (
    <div className={`${isInSplitScreen ? 'mb-2' : 'mb-3'}`} style={{ width: '100%' }}>
      {label && (
        <div className="mb-2 relative flex justify-center items-center">
          <div
            className="text-center text-base font-semibold rounded px-3 py-1.5 inline-block"
            style={{ backgroundColor: activeBg, color: activeText }}
          >
            {label} {labelSuffix}
          </div>
          {labelRightSlot && (
            // top-0 bottom-0 + flex items-center vertically centers without applying a CSS transform —
            // a transform here makes this wrapper the containing block for `position: fixed`, which
            // traps BackupVersionsBar's modal inside the slot instead of overlaying the page.
            <div className="absolute right-0 top-0 bottom-0 flex items-center shrink-0">
              {labelRightSlot}
            </div>
          )}
        </div>
      )}
      {isInSplitScreen ? (
        // Split-screen: compact stacked layout — Year + 1st/2nd Half on one row, then a 4×3 grid of months.
        // Avoids the previous wrap behavior where each month landed on its own line in narrow columns.
        <>
          <div className="flex items-center gap-2 mb-2">
            <select
              value={currentYear}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="px-2 py-1 rounded-md border border-slate-600 bg-slate-800 text-white text-sm font-medium shrink-0 cursor-pointer hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              title="Select year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {clinicPayroll === 2 && (
              <div className="flex items-center gap-1 shrink-0 ml-auto rounded-md border border-slate-600 bg-slate-800 p-0.5">
                <button
                  type="button"
                  onClick={() => handlePayrollChange(1)}
                  className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                    selectedPayroll === 1
                      ? 'bg-primary-600 text-white'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  1st Half
                </button>
                <button
                  type="button"
                  onClick={() => handlePayrollChange(2)}
                  className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                    selectedPayroll === 2
                      ? 'bg-primary-600 text-white'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  2nd Half
                </button>
              </div>
            )}
            {rightSlot && <div className="shrink-0 ml-auto">{rightSlot}</div>}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {MONTHS_SHORT.map((short, idx) => {
              const monthName = MONTHS_FULL[idx]
              const mc = monthColorByName.get(monthName)
              const baseColor = mc?.color ?? '#475569'
              const baseText = mc?.textColor ?? '#fff'
              const isActive = idx === currentMonthIdx
              return (
                <button
                  key={monthName}
                  type="button"
                  onClick={() => handleMonthClick(idx)}
                  title={monthName}
                  aria-pressed={isActive}
                  className={`px-1 py-1 rounded-md text-xs font-semibold transition-all border ${
                    isActive
                      ? 'shadow-md ring-2 ring-white/70'
                      : 'opacity-70 hover:opacity-100 border-transparent'
                  }`}
                  style={{
                    backgroundColor: isActive ? baseColor : hexToRgba(baseColor, 0.55),
                    color: baseText,
                  }}
                >
                  {short}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
          <select
            value={currentYear}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            className="px-2 py-1 rounded-md border border-slate-600 bg-slate-800 text-white text-sm font-medium shrink-0 cursor-pointer hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            title="Select year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <div className="flex gap-1 flex-wrap flex-1 min-w-0 justify-center">
            {MONTHS_SHORT.map((short, idx) => {
              const monthName = MONTHS_FULL[idx]
              const mc = monthColorByName.get(monthName)
              const baseColor = mc?.color ?? '#475569'
              const baseText = mc?.textColor ?? '#fff'
              const isActive = idx === currentMonthIdx
              return (
                <button
                  key={monthName}
                  type="button"
                  onClick={() => handleMonthClick(idx)}
                  title={monthName}
                  aria-pressed={isActive}
                  className={`px-2 py-1 rounded-md text-sm font-semibold transition-all border ${
                    isActive
                      ? 'shadow-md ring-2 ring-white/70 scale-105'
                      : 'opacity-70 hover:opacity-100 border-transparent'
                  }`}
                  style={{
                    backgroundColor: isActive ? baseColor : hexToRgba(baseColor, 0.55),
                    color: baseText,
                    minWidth: 44,
                  }}
                >
                  {short}
                </button>
              )
            })}
          </div>

          {clinicPayroll === 2 && (
            <div className="flex items-center gap-1 shrink-0 ml-auto rounded-md border border-slate-600 bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => handlePayrollChange(1)}
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                  selectedPayroll === 1
                    ? 'bg-primary-600 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                1st Half
              </button>
              <button
                type="button"
                onClick={() => handlePayrollChange(2)}
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                  selectedPayroll === 2
                    ? 'bg-primary-600 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                2nd Half
              </button>
            </div>
          )}

          {rightSlot && <div className="shrink-0">{rightSlot}</div>}
        </div>
      )}
    </div>
  )
}
