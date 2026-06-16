import { useMemo, type ReactNode } from 'react'
import { StatusColor } from '@/types'
import { readableTextColor } from '@/lib/utils'

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
  /** Rendered as its own row immediately below the colored title pill (above the months row). */
  belowTitleSlot?: ReactNode
  /** Year dropdown starts at this year (default 2024). */
  minYear?: number
  /**
   * When true, render the 12 month buttons in a 6-col grid (so they wrap evenly 6+6 in narrow
   * containers). Defaults to false — the standard layout flows the months on a single line via
   * flex-wrap. The Provider Pay tab sets this because its container is narrow enough that the
   * default flex-wrap landed an awkward 8+4 split.
   */
  compactMonthsLayout?: boolean
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
  belowTitleSlot,
  minYear = 2024,
  compactMonthsLayout = false,
}: MonthYearTabsProps) {
  // Always derive the month button text color from the background luminance so dark months get
  // white text and light months get black text — the configured text_color was unreadable in
  // some combinations (e.g. dark-teal May with black text).
  const monthColorByName = useMemo(() => {
    const map = new Map<string, { color: string; textColor: string }>()
    for (const s of statusColors) {
      if (s.type === 'month') {
        map.set(s.status, { color: s.color, textColor: readableTextColor(s.color) })
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

  // In compact mode, render Year ▾ on the left of the title pill and labelRightSlot (Select
  // Version) on the right. Putting them on the title row saves a full line of vertical space
  // versus the prior "title alone, then year row below it" layout.
  const compactYearSelect = (
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
  )

  return (
    <div className={`${isInSplitScreen ? 'mb-2' : 'mb-3'}`} style={{ width: '100%' }}>
      {label && (
        // Compact (split-screen / narrow viewport): Year + Title pill + labelRightSlot on one row.
        // Wide: original centered title + absolutely-positioned right slot.
        <div className={`mb-2 ${isInSplitScreen ? 'flex items-center justify-between gap-2 min-w-0' : 'relative flex justify-center items-center'}`}>
          {isInSplitScreen && compactYearSelect}
          <div
            className={`text-center text-base font-semibold rounded px-3 py-1.5 inline-block ${
              isInSplitScreen ? 'flex-1 min-w-0 truncate' : ''
            }`}
            style={{ backgroundColor: activeBg, color: activeText }}
          >
            {label} {labelSuffix}
          </div>
          {isInSplitScreen && labelRightSlot && <div className="shrink-0">{labelRightSlot}</div>}
          {!isInSplitScreen && labelRightSlot && (
            // top-0 bottom-0 + flex items-center vertically centers without applying a CSS transform —
            // a transform here makes this wrapper the containing block for `position: fixed`, which
            // traps BackupVersionsBar's modal inside the slot instead of overlaying the page.
            <div className="absolute right-0 top-0 bottom-0 flex items-center shrink-0">
              {labelRightSlot}
            </div>
          )}
        </div>
      )}
      {belowTitleSlot && (
        <div className="mb-2 flex justify-center">{belowTitleSlot}</div>
      )}
      {isInSplitScreen ? (
        // Split-screen: payroll toggle (if dual-payroll clinic) and rightSlot (Download CSV) sit
        // on their own thin row only when present, then a 6×2 grid of months. Year + Select
        // Version already moved up to the title row above to save vertical space.
        <>
          {(clinicPayroll === 2 || rightSlot) && (
            <div className="flex items-center flex-wrap gap-2 mb-2 min-w-0">
              {clinicPayroll === 2 && (
                <div className="flex items-center gap-1 shrink-0 rounded-md border border-slate-600 bg-slate-800 p-0.5">
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
          )}
          <div className="grid grid-cols-6 gap-1">
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

          {/* Default: original flex-wrap layout — months flow on a single line on wide containers,
              wrap naturally on narrow ones. compactMonthsLayout=true switches to a 6-col grid so
              narrow containers (e.g. the Provider Pay tab) get a tidy 6+6 split instead of 8+4. */}
          <div
            className={
              compactMonthsLayout
                ? 'grid grid-cols-6 xl:grid-cols-12 gap-1 flex-1 min-w-0'
                : 'flex gap-1 flex-wrap flex-1 min-w-0 justify-center'
            }
          >
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
                    ...(compactMonthsLayout ? {} : { minWidth: 44 }),
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
