import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency } from './utils'

export interface TimecardPaystubDay {
  /** YYYY-MM-DD (calendar day) */
  date: string
  hours: number
}

export interface TimecardPaystubEntry {
  employee_name: string
  employee_id?: string | null
  /** Optional clinic name shown in the header block. */
  clinic_name?: string | null
  clinic_address?: string | null
  clinic_phone?: string | null
  /** "weekly" = single 7-day period, "biweekly" = two 7-day periods combined. */
  frequency: 'weekly' | 'biweekly'
  pay_period_label: string
  /** Ordinal payment date printed in the header ("Pay Date"). Falls back to today. */
  pay_date: string
  /** Per-day totals within the pay period. Blank / missing days can be omitted. */
  days: TimecardPaystubDay[]
  total_hours: number
  hourly_rate: number
  /** Optional YTD hours & pay totals; both hidden when null. */
  ytd_hours?: number | null
  ytd_pay?: number | null
  /** Optional accent color for the name band (hex "#rrggbb"). Falls back to light blue. */
  accent_color?: string | null
  notes?: string | null
}

const LOGO_X = 14
const LOGO_Y = 10

function parseAccent(hex: string | null | undefined): [number, number, number] {
  const fallback: [number, number, number] = [173, 216, 230]
  if (!hex) return fallback
  const m = /^#?([a-f0-9]{6})$/i.exec(hex.trim())
  if (!m) return fallback
  const h = m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function formatDateShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })
}

/**
 * Build a paystub PDF for a staff member's timecards.
 *
 * Layout intentionally mirrors the Provider Pay paystub (Invoices.tsx) so the client's employees
 * see a consistent format:
 *   - Header: business info left, "Earnings Statement" + pay period/date right
 *   - Accent band with employee name + stub number
 *   - Earnings table: one row per day worked (or the full period), with the total row bold
 *   - Direct Deposit band with net pay
 *   - Footer paragraph
 *
 * The table shows Hours × Rate = Amount per day so weekly and biweekly stubs both read the same.
 */
export function generateTimecardPaystubPdf(entry: TimecardPaystubEntry): jsPDF {
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()
  const [accentR, accentG, accentB] = parseAccent(entry.accent_color)

  // Header: business info block on the left, "Earnings Statement" on the right
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  const clinicName = entry.clinic_name?.trim() || 'Timecard Paystub'
  doc.text(clinicName, LOGO_X, LOGO_Y + 4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  let leftY = LOGO_Y + 10
  const addressLines = (entry.clinic_address ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  for (const line of addressLines) {
    doc.text(line, LOGO_X, leftY)
    leftY += 5
  }
  if (entry.clinic_phone?.trim()) {
    doc.text(entry.clinic_phone.trim(), LOGO_X, leftY)
    leftY += 5
  }

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  const esLabel = 'Earnings Statement'
  doc.text(esLabel, pageW - 14 - doc.getTextWidth(esLabel), 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const freqLabel = entry.frequency === 'biweekly' ? 'Biweekly' : 'Weekly'
  const ppLabel = `Pay Period: ${entry.pay_period_label} (${freqLabel})`
  const pdLabel = `Pay Date: ${entry.pay_date}`
  doc.text(ppLabel, pageW - 14 - doc.getTextWidth(ppLabel), 37)
  doc.text(pdLabel, pageW - 14 - doc.getTextWidth(pdLabel), 43)

  // Employee name band (mirrors provider paystub accent band)
  const bandY = Math.max(leftY + 4, 50)
  const bandH = 18
  doc.setFillColor(accentR, accentG, accentB)
  doc.rect(14, bandY, pageW - 28, bandH, 'F')
  const bandTextY = bandY + bandH / 2 + 3
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text(entry.employee_name, 18, bandTextY)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (entry.employee_id) {
    const stubLabel = `Employee: ${entry.employee_id}`
    doc.text(stubLabel, pageW - 14 - doc.getTextWidth(stubLabel) - 6, bandTextY)
  }

  // Earnings table: one row per day worked, then a bold Total row. Rate column intentionally
  // omitted — the client only wants Date / Hours / Amount on the printed paystub since the rate
  // is managed in User Management, not on each stub.
  const tableStartY = bandY + bandH + 6
  const tableMargin = 14
  const tableWidth = pageW - tableMargin * 2
  const bodyRows = entry.days
    .filter((d) => Number.isFinite(d.hours) && d.hours > 0)
    .map((d) => {
      const amount = d.hours * entry.hourly_rate
      return [
        formatDateShort(d.date),
        d.hours.toFixed(2),
        formatCurrency(amount),
      ]
    })
  const netPay = entry.total_hours * entry.hourly_rate
  bodyRows.push([
    { content: 'Total', styles: { fontStyle: 'bold' as const, halign: 'left' as const } } as any,
    { content: entry.total_hours.toFixed(2), styles: { fontStyle: 'bold' as const, halign: 'right' as const } } as any,
    { content: formatCurrency(netPay), styles: { fontStyle: 'bold' as const, halign: 'right' as const } } as any,
  ])

  autoTable(doc, {
    theme: 'grid',
    head: [[
      { content: 'Date', styles: { halign: 'left' } },
      { content: 'Hours', styles: { halign: 'right' } },
      { content: 'Amount', styles: { halign: 'right' } },
    ]],
    body: bodyRows,
    startY: tableStartY,
    tableWidth,
    styles: { fontSize: 9, lineColor: [0, 0, 0], lineWidth: 0.2, cellPadding: 3 },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    bodyStyles: { lineColor: [0, 0, 0], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: tableWidth * 0.45, halign: 'left' },
      1: { cellWidth: tableWidth * 0.25, halign: 'right' },
      2: { cellWidth: tableWidth * 0.3, halign: 'right' },
    },
    margin: { left: tableMargin, right: tableMargin },
  })

  const afterTableY: number = (doc as any).lastAutoTable.finalY + 6

  // YTD block (optional)
  let ddY = afterTableY
  if (entry.ytd_hours != null || entry.ytd_pay != null) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    if (entry.ytd_hours != null) {
      doc.text(`YTD Hours: ${entry.ytd_hours.toFixed(2)}`, 14, ddY + 4)
    }
    if (entry.ytd_pay != null) {
      const label = `YTD Pay: ${formatCurrency(entry.ytd_pay)}`
      doc.text(label, pageW - 14 - doc.getTextWidth(label), ddY + 4)
    }
    ddY += 8
  }

  // Direct Deposit / Net Pay band
  const ddBandH = 14
  doc.setFillColor(accentR, accentG, accentB)
  doc.rect(14, ddY, pageW - 28, ddBandH, 'F')
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('Direct Deposit Amount:', 18, ddY + 9)
  const ddStr = formatCurrency(netPay)
  doc.text(ddStr, pageW - 14 - doc.getTextWidth(ddStr) - 6, ddY + 9)

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')

  // Optional notes / closing
  let footerY = ddY + ddBandH + 10
  if (entry.notes?.trim()) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Notes:', 14, footerY)
    doc.setFont('helvetica', 'normal')
    footerY += 5
    const wrapped = doc.splitTextToSize(entry.notes.trim(), pageW - 28)
    for (const line of wrapped) {
      doc.text(line, 14, footerY)
      footerY += 5
    }
    footerY += 4
  }

  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.text(
    'Please retain this earnings statement for your records.',
    14,
    footerY,
  )

  return doc
}

/** Slugify a name so it can safely appear in a downloaded filename. */
export function paystubFilename(entry: TimecardPaystubEntry): string {
  const safe = entry.employee_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `paystub-${safe || 'employee'}-${entry.pay_period_label.replace(/[^0-9a-zA-Z]+/g, '_')}.pdf`
}
