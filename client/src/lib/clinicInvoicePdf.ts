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
  note?: string
}

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

export async function generateClinicInvoicePdf(
  row: ClinicInvoiceSummaryRow,
  selectedMonth: Date
): Promise<jsPDF> {
  const doc = new jsPDF()
  const pageW = doc.internal.pageSize.getWidth()
  let y = 20

  try {
    const logoDataUrl = await loadLogoAsDataUrl()
    doc.addImage(logoDataUrl, 'PNG', 14, 10, 36, 18)
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
  const dueDate = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 15)
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
  // Total = ins + patient pay + AR + additional fee; billing amount = total * invoice rate
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

  return doc
}
