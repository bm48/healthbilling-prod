import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency } from './utils'

export interface ClinicInvoiceSummaryRow {
  clinic_id: string
  clinic_name: string
  clinic_address_1: string
  clinic_address_2: string
  insurance_payment_total: number
  patient_payment_total: number
  accounts_receivable_total: number
  additional_fee?: number
  total: number
  invoice_total: number
  invoice_rate: number | null
  payment_status: string
  payment_date: string | null
  due_date?: string | null
  note?: string
}

/** Per-provider data for the paystub page (page 2+). */
export interface PaystubEntry {
  provider_name: string
  emp_id: string
  stub_no: string
  pay_period: string
  pay_date: string
  clinic_name: string
  clinic_address: string
  clinic_phone: string
  clinic_ein: string
  /** Regular month payments row */
  month_amount_collected: number
  month_total_owed: number
  /** A/R payments row */
  ar_amount_collected: number
  ar_total_owed: number
  /** Year-to-date total owed (null if unknown) */
  ytd: number | null
  /** Direct deposit / net pay */
  direct_deposit_amount: number
}

const LOGO_X = 14
const LOGO_Y = 10
const INVOICE_LOGO_W = 52
const INVOICE_LOGO_H = 26
const PAYSTUB_LOGO_W = 40
const PAYSTUB_LOGO_H = 20

async function loadLogoAsDataUrl(): Promise<string> {
  const res = await fetch('/Logo.png')
  if (!res.ok) throw new Error('Logo not found')
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function formatDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

function addPaystubPage(doc: jsPDF, entry: PaystubEntry, logoDataUrl: string | null): void {
  doc.addPage()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // ── Header: left = clinic info, right = "Earnings Statement" block ──────
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', LOGO_X, LOGO_Y, PAYSTUB_LOGO_W, PAYSTUB_LOGO_H)
    } catch { /* skip */ }
  }

  const clinicBlockY = LOGO_Y + PAYSTUB_LOGO_H + 6
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(entry.clinic_name, LOGO_X, clinicBlockY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const clinicLines = entry.clinic_address.split('\n').filter(Boolean)
  let leftY = clinicBlockY + 6
  for (const line of clinicLines) {
    doc.text(line, 14, leftY)
    leftY += 5
  }
  if (entry.clinic_phone) {
    doc.text(entry.clinic_phone, 14, leftY)
    leftY += 5
  }
  if (entry.clinic_ein) {
    doc.text(`EIN: ${entry.clinic_ein}`, 14, leftY)
  }

  // Right block
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  const esLabel = 'Earnings Statement'
  doc.text(esLabel, pageW - 14 - doc.getTextWidth(esLabel), 30)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const ppLabel = `Pay Period: ${entry.pay_period}`
  const pdLabel = `Pay Date: ${entry.pay_date}`
  doc.text(ppLabel, pageW - 14 - doc.getTextWidth(ppLabel), 37)
  doc.text(pdLabel, pageW - 14 - doc.getTextWidth(pdLabel), 43)

  // ── Provider name band (light blue) ─────────────────────────────────────
  const bandY = 58
  const bandH = 18
  doc.setFillColor(173, 216, 230)
  doc.rect(14, bandY, pageW - 28, bandH, 'F')

  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text(entry.provider_name, 18, bandY + 7)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Emp. ID: ${entry.emp_id}`, pageW - 14 - doc.getTextWidth(`Emp. ID: ${entry.emp_id}`) -6, bandY + 6)
  doc.text(`Stub No: ${entry.stub_no}`, pageW - 14 - doc.getTextWidth(`Stub No: ${entry.stub_no}`) -6, bandY + 12)

  // ── Earnings table ───────────────────────────────────────────────────────
  const tableStartY = bandY + bandH + 6
  const tableMargin = 14
  const tableWidth = pageW - tableMargin * 2
  const col0W = tableWidth * 0.30
  const col1W = tableWidth * 0.25
  const col2W = tableWidth * 0.25
  const col3W = tableWidth - col0W - col1W - col2W
  const ytdCell = entry.ytd != null ? formatCurrency(entry.ytd) : '—'
  const totalOwed = formatCurrency(entry.month_total_owed + entry.ar_total_owed)

  autoTable(doc, {
    theme: 'grid',
    head: [[
      { content: 'Payment Month', styles: { halign: 'left' } },
      { content: 'Amount Collected', styles: { halign: 'right' } },
      { content: 'Total Owed', styles: { halign: 'right' } },
      { content: 'YTD', styles: { halign: 'right' } },
    ]],
    body: [
      [
        entry.pay_period,
        formatCurrency(entry.month_amount_collected),
        formatCurrency(entry.month_total_owed),
        '—',
      ],
      [
        'Accounts Receivable',
        formatCurrency(entry.ar_amount_collected),
        formatCurrency(entry.ar_total_owed),
        '—',
      ],
      [
        '\u00a0',
        '\u00a0',
        totalOwed,
        ytdCell,
      ],
    ],
    startY: tableStartY,
    tableWidth,
    styles: {
      fontSize: 9,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      cellPadding: 3,
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    bodyStyles: {
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: col0W, halign: 'left' },
      1: { cellWidth: col1W, halign: 'right' },
      2: { cellWidth: col2W, halign: 'right' },
      3: { cellWidth: col3W, halign: 'right' },
    },
    margin: { left: tableMargin, right: tableMargin },
  })

  const afterTableY: number = (doc as any).lastAutoTable.finalY + 6

  // ── Direct Deposit Amount band ───────────────────────────────────────────
  const ddBandH = 14
  doc.setFillColor(173, 216, 230)
  doc.rect(14, afterTableY, pageW - 28, ddBandH, 'F')
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Direct Deposit Amount:', 18, afterTableY + 9)
  const ddStr = formatCurrency(entry.direct_deposit_amount)
  doc.text(ddStr, pageW - 14 - doc.getTextWidth(ddStr) - 6, afterTableY + 9)

  // Reset text color for subsequent pages
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  // Suppress unused variable warning on pageH
  void pageH
}

export async function generateClinicInvoicePdf(
  row: ClinicInvoiceSummaryRow,
  selectedMonth: Date,
  paystubs?: PaystubEntry[],
): Promise<jsPDF> {
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()
  let y = 20

  let logoDataUrl: string | null = null
  try {
    logoDataUrl = await loadLogoAsDataUrl()
    doc.addImage(logoDataUrl, 'PNG', LOGO_X, LOGO_Y, INVOICE_LOGO_W, INVOICE_LOGO_H)
  } catch {
    doc.setFontSize(12)
    doc.text('American Medical Billing & Coding LLC', 14, 18)
  }

  doc.setFontSize(22)
  doc.text('INVOICE', pageW - 14 - doc.getTextWidth('INVOICE'), 22)
  const invoiceNum = `#${row.clinic_id.slice(0, 6).toUpperCase()}-${selectedMonth.getFullYear()}${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`
  doc.setFontSize(11)
  doc.text(invoiceNum, pageW - 14 - doc.getTextWidth(invoiceNum), 30)
  const invoiceDate = formatDateShort(new Date())
  const dueDate = row.due_date
    ? new Date(row.due_date + 'T00:00:00')
    : new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 15)
  doc.text(`Date: ${invoiceDate}`, pageW - 14 - doc.getTextWidth(`Date: ${invoiceDate}`), 36)
  doc.text(`Due Date: ${formatDateShort(dueDate)}`, pageW - 14 - doc.getTextWidth(`Due Date: ${formatDateShort(dueDate)}`), 42)

  y = 48
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Bill To:', 14, y)
  doc.setFont('helvetica', 'normal')
  doc.text(row.clinic_name, 14, y + 6)
  doc.text(row.clinic_address_1, 14, y + 12)
  if (row.clinic_address_2?.trim()) {
    doc.text(row.clinic_address_2.trim(), 14, y + 18)
    y += 24
  } else {
    y += 18
  }

  const total = row.total
  const rate = row.invoice_rate != null ? row.invoice_rate : 0
  const billingAmount = total * rate

  doc.setDrawColor(200, 200, 200)
  doc.setFillColor(240, 240, 240)
  doc.rect(14, y - 4, pageW - 28, 14, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Balance Due:', 18, y + 5)
  doc.text(formatCurrency(billingAmount), pageW - 18 - doc.getTextWidth(formatCurrency(billingAmount)), y + 5)
  doc.setFont('helvetica', 'normal')
  y += 22

  const ratePct = row.invoice_rate != null ? (row.invoice_rate * 100).toFixed(2) : '0'
  const tableBody: (string | number)[][] = [
    ['Total (Insurance + Patient Pay + AR + Additional Fee)', '$0.00', formatCurrency(total)],
    [`Billing Fee: ${ratePct}% of Total`, formatCurrency(billingAmount), formatCurrency(billingAmount)],
  ]
  autoTable(doc, {
    head: [['Item', 'Rate', 'Amount']],
    body: tableBody,
    startY: y,
    headStyles: { fillColor: [80, 80, 80] },
    margin: { left: 14, right: 14 },
  })
  y = (doc as any).lastAutoTable.finalY + 14

  doc.setFont('helvetica', 'bold')
  doc.text(`Total: ${formatCurrency(billingAmount)}`, pageW - 14 - doc.getTextWidth(`Total: ${formatCurrency(billingAmount)}`), y)
  doc.setFont('helvetica', 'normal')
  y += 14

  const additionalFee = row.additional_fee != null ? Number(row.additional_fee) : 0
  const hasNote = (row.note?.trim() ?? '').length > 0
  if (additionalFee !== 0 || hasNote) {
    doc.setFont('helvetica', 'bold')
    doc.text('Notes:', 14, y)
    doc.setFont('helvetica', 'normal')
    y += 6
    if (additionalFee !== 0) {
      doc.text(`Additional fee: ${formatCurrency(additionalFee)}`, 14, y)
      y += 6
    }
    if (hasNote) {
      const maxWidth = pageW - 28
      const lines = doc.splitTextToSize(row.note!.trim(), maxWidth)
      for (const line of lines) {
        doc.text(line, 14, y)
        y += 6
      }
    }
  }

  // ── Page 2+: Provider paystubs ───────────────────────────────────────────
  if (paystubs && paystubs.length > 0) {
    for (const stub of paystubs) {
      addPaystubPage(doc, stub, logoDataUrl)
    }
  }

  return doc
}
