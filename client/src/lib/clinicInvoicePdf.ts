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
  payment_date: string | null
  due_date?: string | null
  note?: string
  /** When true the clinic is in per-provider billing mode; render one Total + Billing Fee pair
   *  for each entry in `provider_lines` instead of a single clinic-wide pair. */
  invoice_per_provider?: boolean
  /** Per-provider breakdown emitted from the server (`invoice_provider_lines`). Only used when
   *  `invoice_per_provider` is true. Each line carries the provider's collected total, the
   *  effective rate, and the provider's slice of the billing fee. */
  provider_lines?: Array<{
    provider_id: string
    provider_name: string
    insurance_payment_total: number
    patient_payment_total: number
    accounts_receivable_total: number
    subtotal: number
    invoice_rate: number
    invoice_total: number
  }>
  /** Multi-line additional fees. Each renders as its own row at the end of the invoice table,
   *  labeled with `label` and charged at face value (never multiplied by a billing rate). */
  additional_fee_lines?: Array<{ label: string; amount: number }>
}

/** Per-provider data for the paystub page (page 2+). */
export interface PaystubEntry {
  provider_name: string
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
  /** Direct deposit / net pay (already includes the sum of `adjustments` amounts). */
  direct_deposit_amount: number
  /** "Paystub Additional Pay" rows from the Provider Pay grid (the dedicated row range
   *  PP_ROW_ADJUSTMENTS_START..PP_ROW_ADJUSTMENTS_END with a non-empty Description). Printed
   *  inline as extra rows in the main earnings table (one per entry) with `Amount Collected`
   *  blank and `Total Owed` = `amount`. Amounts are signed: positive = added, negative = deducted.
   *  Notes are optional per row. */
  adjustments?: Array<{ description: string; amount: number; notes: string }>
  /** Optional clinic-specific logo (data URL) to render in the paystub header. When omitted, NO
   *  logo is rendered — the American Medical Billing logo never appears on the provider's paystub. */
  clinic_logo_data_url?: string | null
  /** Natural pixel width of the clinic logo (from `new Image().naturalWidth`). Used together with
   *  `clinic_logo_natural_height` to fit the logo inside the paystub's bounding box without
   *  stretching. Optional: if missing/zero, the renderer falls back to the bounding-box size. */
  clinic_logo_natural_width?: number | null
  /** Natural pixel height of the clinic logo. See `clinic_logo_natural_width`. */
  clinic_logo_natural_height?: number | null
  /** Optional clinic-specific accent color as a "#rrggbb" hex string. Applied to the provider-name
   *  band and the Direct Deposit Amount band. Defaults to light blue (#add8e6) when omitted. */
  paystub_accent_color?: string | null
}

const LOGO_X = 14
const LOGO_Y = 10
const INVOICE_LOGO_W = 52
const INVOICE_LOGO_H = 26
// Square bounding box for clinic paystub logos. Square logos fill it 30mm × 30mm; wide and tall
// logos aspect-fit inside the same square area without stretching. (The earlier 40×20 wide box
// stretched square logos 2:1 horizontally any time the natural-dimension measurement didn't
// reach the renderer.)
const PAYSTUB_LOGO_W = 30
const PAYSTUB_LOGO_H = 30

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

/** Format stored invoice/payment date for PDF (M/D/YYYY). */
export function formatInvoicePdfDate(isoDate: string | null | undefined): string {
  if (!isoDate?.trim()) return '—'
  const d = new Date(isoDate.includes('T') ? isoDate : `${isoDate.trim()}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return formatDateShort(d)
}

const PAYSTUB_CLOSING_PARAGRAPH_1 =
  'Please refer to your billing spreadsheet for specific payment amounts and reach out if you have any questions in regards to your pay.'
const PAYSTUB_CLOSING_PARAGRAPH_2 =
  'Thank you for all your hard work- We appreciate you!'

function addPaystubClosingFooter(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 14
  const maxWidth = pageW - marginX * 2
  const lineHeight = 5
  const paragraphGap = 6
  const bottomMargin = 20

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(0, 0, 0)

  const lines1 = doc.splitTextToSize(PAYSTUB_CLOSING_PARAGRAPH_1, maxWidth)
  const lines2 = doc.splitTextToSize(PAYSTUB_CLOSING_PARAGRAPH_2, maxWidth)
  const blockHeight = lines1.length * lineHeight + paragraphGap + lines2.length * lineHeight
  let y = pageH - bottomMargin - blockHeight

  for (const line of lines1) {
    doc.text(line, marginX, y)
    y += lineHeight
  }
  y += paragraphGap
  for (const line of lines2) {
    doc.text(line, marginX, y)
    y += lineHeight
  }
}

/** Parse a "#rrggbb" hex string into a jsPDF-friendly [r, g, b] triple. Falls back to the default
 *  light-blue accent ([173, 216, 230]) if the input is missing or malformed. */
function parsePaystubAccent(hex: string | null | undefined): [number, number, number] {
  const fallback: [number, number, number] = [173, 216, 230]
  if (!hex) return fallback
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Read the natural pixel size of an image data URL via the browser's Image decoder. Returns
 *  {0,0} if decoding fails — the caller treats that as "no dimensions, use the bounding box". */
async function measureImageDataUrl(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = dataUrl
  })
}

async function addPaystubPage(
  doc: jsPDF,
  entry: PaystubEntry,
  _invoiceLogoDataUrl: string | null,
  isLastPaystub: boolean,
): Promise<void> {
  // The American Medical Billing logo is intentionally NOT used on the paystub page (Jenali: "if
  // there isn't a logo uploaded, nothing — not the American Medical Billing Logo"). Each paystub
  // gets its own clinic logo from entry.clinic_logo_data_url, or no logo at all.
  void _invoiceLogoDataUrl
  doc.addPage()
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const [accentR, accentG, accentB] = parsePaystubAccent(entry.paystub_accent_color)

  // ── Header: left = clinic info, right = "Earnings Statement" block ──────
  let clinicLogoRendered = false
  let renderedLogoH = 0
  if (entry.clinic_logo_data_url) {
    try {
      // Detect the actual image format from the data URL prefix; jsPDF needs the right format
      // string ('PNG' | 'JPEG' | 'GIF' | 'WEBP'). Falls back to PNG for anything unrecognized.
      const mime = /^data:image\/(png|jpeg|jpg|gif|webp)/i.exec(entry.clinic_logo_data_url)?.[1]?.toLowerCase()
      const fmt =
        mime === 'jpeg' || mime === 'jpg' ? 'JPEG'
        : mime === 'gif' ? 'GIF'
        : mime === 'webp' ? 'WEBP'
        : 'PNG'
      // Aspect-fit the logo inside the PAYSTUB_LOGO_W × PAYSTUB_LOGO_H bounding box so wide /
      // tall / square logos all render at their natural proportions (no stretching). The caller
      // (Invoices.tsx) usually measures the natural dimensions for us; if those are missing or
      // zero we re-measure here so the renderer is robust on its own.
      let naturalW = entry.clinic_logo_natural_width ?? 0
      let naturalH = entry.clinic_logo_natural_height ?? 0
      if (naturalW <= 0 || naturalH <= 0) {
        const measured = await measureImageDataUrl(entry.clinic_logo_data_url)
        naturalW = measured.w
        naturalH = measured.h
      }
      let drawW = PAYSTUB_LOGO_W
      let drawH = PAYSTUB_LOGO_H
      if (naturalW > 0 && naturalH > 0) {
        const aspect = naturalW / naturalH
        drawW = PAYSTUB_LOGO_W
        drawH = drawW / aspect
        if (drawH > PAYSTUB_LOGO_H) {
          drawH = PAYSTUB_LOGO_H
          drawW = drawH * aspect
        }
      }
      doc.addImage(entry.clinic_logo_data_url, fmt, LOGO_X, LOGO_Y, drawW, drawH)
      clinicLogoRendered = true
      renderedLogoH = drawH
    } catch (e) {
      // Unsupported format / corrupt data → fall through to no-logo layout
      console.warn('[clinicInvoicePdf] addImage failed for clinic logo, rendering paystub without logo:', e)
    }
  }

  // When no clinic logo, drop the address block up by the logo's height so we don't leave a gap.
  // When a logo is rendered, use the actual rendered height (aspect-fit may have shrunk it).
  const clinicBlockY = clinicLogoRendered ? LOGO_Y + renderedLogoH + 6 : LOGO_Y + 4
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
  // EIN is intentionally NOT rendered on the paystub (per Jenali — not necessary on the
  // earnings statement and added clutter that overlapped the provider name band).

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

  // ── Provider name band (clinic-configurable accent color) ─────────────────
  // Dynamically anchor below whichever extends further: the clinic info block on the left or the
  // pay-date block on the right (~Y=47 after the two lines + padding). Used to be hardcoded at
  // Y=58, which overlapped the clinic address whenever there were 3+ lines of clinic info.
  const bandY = Math.max(leftY + 4, 50)
  const bandH = 18
  doc.setFillColor(accentR, accentG, accentB)
  doc.rect(14, bandY, pageW - 28, bandH, 'F')

  const bandTextY = bandY + bandH / 2 + 3
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text(entry.provider_name, 18, bandTextY)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  const stubLabel = `Stub No: ${entry.stub_no}`
  doc.text(stubLabel, pageW - 14 - doc.getTextWidth(stubLabel) - 6, bandTextY)

  // ── Earnings table ───────────────────────────────────────────────────────
  const tableStartY = bandY + bandH + 6
  const tableMargin = 14
  const tableWidth = pageW - tableMargin * 2
  const col0W = tableWidth * 0.30
  const col1W = tableWidth * 0.25
  const col2W = tableWidth * 0.25
  const col3W = tableWidth - col0W - col1W - col2W
  const ytdCell = entry.ytd != null ? formatCurrency(entry.ytd) : '—'
  // Layout per Jenali's mockup: month payments row, A/R row, one row per "Paystub Additional Pay"
  // entry (Amount Collected blank, Total Owed = the user-typed amount, sign preserved), then a
  // Total row that sums Total Owed including those adjustments.
  const adjustments = (entry.adjustments ?? []).filter((a) => a.description.trim().length > 0)
  const adjustmentsTotal = adjustments.reduce(
    (s, a) => s + (Number.isFinite(a.amount) ? a.amount : 0),
    0,
  )
  const grandTotalOwed = entry.month_total_owed + entry.ar_total_owed + adjustmentsTotal
  const adjustmentRows = adjustments.map((a) => [
    a.description,
    ' ', // Amount Collected blank — "Just Total Owed" per Jenali's annotation
    formatCurrency(a.amount),
    a.notes && a.notes.trim().length > 0 ? a.notes : ' ',
  ])
  const totalOwed = formatCurrency(grandTotalOwed)

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
      ...adjustmentRows,
      [
        { content: 'Total', styles: { fontStyle: 'bold' as const, halign: 'left' as const } },
        '\u00a0',
        { content: totalOwed, styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
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
  // (Paystub Additional Pay rows are now part of the main earnings table above, so there is no
  // longer a separate Adjustments table here. The Direct Deposit Amount band already reflects
  // the same grand total via entry.direct_deposit_amount.)

  // ── Direct Deposit Amount band ───────────────────────────────────────────
  const ddBandH = 14
  doc.setFillColor(accentR, accentG, accentB)
  doc.rect(14, afterTableY, pageW - 28, ddBandH, 'F')
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Direct Deposit Amount:', 18, afterTableY + 9)
  const ddStr = formatCurrency(entry.direct_deposit_amount)
  doc.text(ddStr, pageW - 14 - doc.getTextWidth(ddStr) - 6, afterTableY + 9)

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')

  if (isLastPaystub) {
    addPaystubClosingFooter(doc)
  }

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
  const dueDate = row.due_date
    ? new Date(row.due_date.includes('T') ? row.due_date : `${row.due_date}T00:00:00`)
    : new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 15)
  let headerY = 36
  const paymentDateText = formatInvoicePdfDate(row.payment_date)
  const paymentLabel = `Payment Date: ${paymentDateText}`
  doc.text(paymentLabel, pageW - 14 - doc.getTextWidth(paymentLabel), headerY)
  headerY += 6
  const dueLabel = `Due Date: ${formatDateShort(dueDate)}`
  doc.text(dueLabel, pageW - 14 - doc.getTextWidth(dueLabel), headerY)
  headerY += 6

  y = Math.max(52, headerY + 4)
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

  // Collected total = Insurance + Patient Pay + AR. additional_fee is NOT folded in here — it
  // gets its own line on the table below at face value. invoice_total already reflects:
  //   per-provider mode: Σ(provider lines) + additional_fee
  //   clinic mode:       collectedTotal × rate + additional_fee
  const collectedTotal = row.total
  const clinicRate = row.invoice_rate != null ? row.invoice_rate : 0
  const additionalFee = row.additional_fee != null ? Number(row.additional_fee) : 0
  const balanceDue = row.invoice_total

  doc.setDrawColor(200, 200, 200)
  doc.setFillColor(240, 240, 240)
  doc.rect(14, y - 4, pageW - 28, 14, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Balance Due:', 18, y + 5)
  doc.text(formatCurrency(balanceDue), pageW - 18 - doc.getTextWidth(formatCurrency(balanceDue)), y + 5)
  doc.setFont('helvetica', 'normal')
  y += 22

  // Build the line-item table.
  // - Quantity column holds the collected total in bold for "Total ..." rows; "1" for billing fee
  //   rows; blank for the additional-fee row.
  // - Rate / Amount columns are blank ("—") for the "Total ..." rows since no charge is being
  //   applied at that line; for billing-fee rows they hold the computed fee.
  // - additional_fee is rendered on its own line at face value (no rate multiplier), labeled with
  //   the invoice note when present so the client knows what the flat charge is for.
  const tableBody: Array<Array<string | { content: string; styles?: Record<string, unknown> }>> = []

  const usePerProvider =
    Boolean(row.invoice_per_provider) && (row.provider_lines?.length ?? 0) > 0

  if (usePerProvider) {
    for (const line of row.provider_lines!) {
      const ratePct = (line.invoice_rate * 100).toFixed(2)
      tableBody.push([
        `${line.provider_name} Total (Insurance/Patient Pay/AR)`,
        {
          content: formatCurrency(line.subtotal),
          styles: { fontStyle: 'bold', halign: 'right' },
        },
        { content: '—', styles: { halign: 'right' } },
        { content: '—', styles: { halign: 'right' } },
      ])
      tableBody.push([
        // Indent the billing-fee row so it visually nests under the provider's Total above it
        // (extra left padding on the Item cell, no extra characters that would muddle copy/paste).
        {
          content: `Billing Fee for ${line.provider_name}: ${ratePct}% of Total`,
          styles: { cellPadding: { top: 3, right: 3, bottom: 3, left: 10 } },
        },
        // Collected column intentionally blank on billing-fee rows — no quantity to show.
        { content: '—', styles: { halign: 'right' } },
        { content: formatCurrency(line.invoice_total), styles: { halign: 'right' } },
        { content: formatCurrency(line.invoice_total), styles: { halign: 'right' } },
      ])
    }
  } else {
    const clinicRatePct = (clinicRate * 100).toFixed(2)
    const clinicBillingFee = collectedTotal * clinicRate
    tableBody.push([
      'Total (Insurance/Patient Pay/AR)',
      {
        content: formatCurrency(collectedTotal),
        styles: { fontStyle: 'bold', halign: 'right' },
      },
      { content: '—', styles: { halign: 'right' } },
      { content: '—', styles: { halign: 'right' } },
    ])
    tableBody.push([
      // Indent the billing-fee row so it visually nests under the Total row above it.
      {
        content: `Billing Fee: ${clinicRatePct}% of Total`,
        styles: { cellPadding: { top: 3, right: 3, bottom: 3, left: 10 } },
      },
      // Collected column intentionally blank on billing-fee rows — no quantity to show.
      { content: '—', styles: { halign: 'right' } },
      { content: formatCurrency(clinicBillingFee), styles: { halign: 'right' } },
      { content: formatCurrency(clinicBillingFee), styles: { halign: 'right' } },
    ])
  }

  // Additional fee lines (multi-row). Each line renders as its own table row with its own label
  // and amount; all fees are billed at face value (no rate multiplier). Falls back to the legacy
  // single `additional_fee` value when the parent didn't pass any lines (e.g. pre-migration data,
  // or until the page's data layer is updated).
  const additionalLines: Array<{ label: string; amount: number }> = row.additional_fee_lines
    && row.additional_fee_lines.length > 0
    ? row.additional_fee_lines
    : additionalFee !== 0
      ? [{ label: (row.note?.trim() ?? '').length > 0 ? row.note!.trim() : 'Additional Fee', amount: additionalFee }]
      : []
  for (const line of additionalLines) {
    if (!Number.isFinite(line.amount) || line.amount === 0) continue
    tableBody.push([
      (line.label ?? '').trim() || 'Additional Fee',
      { content: '—', styles: { halign: 'right' } },
      { content: '—', styles: { halign: 'right' } },
      { content: formatCurrency(line.amount), styles: { halign: 'right' } },
    ])
  }

  autoTable(doc, {
    head: [[
      { content: 'Item', styles: { halign: 'left' } },
      { content: 'Collected', styles: { halign: 'right' } },
      { content: 'Fees', styles: { halign: 'right' } },
      { content: 'Amount', styles: { halign: 'right' } },
    ]],
    body: tableBody,
    startY: y,
    headStyles: { fillColor: [80, 80, 80] },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  })
  y = (doc as any).lastAutoTable.finalY + 14

  doc.setFont('helvetica', 'bold')
  const totalLabel = `Total: ${formatCurrency(balanceDue)}`
  doc.text(totalLabel, pageW - 14 - doc.getTextWidth(totalLabel), y)
  doc.setFont('helvetica', 'normal')
  y += 14

  // Surface the standalone clinic note as a memo underneath the table when present. Each
  // additional fee already carries its own label as a table row above, so the note here is a
  // free-form invoice memo (not tied to any specific fee).
  if ((row.note?.trim() ?? '').length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.text('Notes:', 14, y)
    doc.setFont('helvetica', 'normal')
    y += 6
    const maxWidth = pageW - 28
    const lines = doc.splitTextToSize(row.note!.trim(), maxWidth)
    for (const line of lines) {
      doc.text(line, 14, y)
      y += 6
    }
  }

  // ── Page 2+: Provider paystubs ───────────────────────────────────────────
  if (paystubs && paystubs.length > 0) {
    for (let i = 0; i < paystubs.length; i++) {
      await addPaystubPage(doc, paystubs[i], logoDataUrl, i === paystubs.length - 1)
    }
  }

  return doc
}
