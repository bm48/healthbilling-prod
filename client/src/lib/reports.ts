import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCurrency, formatDate } from './utils'
import { ProviderSheet, SheetRow, Timecard, User, Clinic } from '@/types'

export interface ReportData {
  startDate: Date
  endDate: Date
  clinicId?: string
  providerId?: string
}

export async function generateProviderReport(
  sheets: ProviderSheet[],
  users: User[],
  reportData: ReportData,
  rowsBySheetId: Record<string, SheetRow[]>
): Promise<jsPDF> {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.text('Provider Report', 14, 22)
  doc.setFontSize(12)
  doc.text(`Period: ${formatDate(reportData.startDate.toISOString())} - ${formatDate(reportData.endDate.toISOString())}`, 14, 30)

  const tableData: any[] = []
  
  sheets.forEach(sheet => {
    const provider = users.find(u => u.id === sheet.provider_id)
    const rows = rowsBySheetId[sheet.id] || []
    
    let totalInsurance = 0
    let totalPatient = 0
    let totalAR = 0

    rows.forEach((row: SheetRow) => {
      totalInsurance += parseFloat(row.insurance_payment as string) || 0
      totalPatient += parseFloat(row.collected_from_patient as string) || 0
      totalAR += row.ar_amount || 0
    })

    tableData.push([
      provider?.full_name || provider?.email || 'Unknown',
      formatCurrency(totalInsurance),
      formatCurrency(totalPatient),
      formatCurrency(totalAR),
      formatCurrency(totalInsurance + totalPatient + totalAR),
    ])
  })

  autoTable(doc, {
    head: [['Provider', 'Insurance Payments', 'Patient Payments', 'AR', 'Total']],
    body: tableData,
    startY: 40,
  })

  return doc
}

export async function generateClinicReport(
  sheets: ProviderSheet[],
  users: User[],
  clinics: Clinic[],
  reportData: ReportData,
  rowsBySheetId: Record<string, SheetRow[]>
): Promise<jsPDF> {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.text('Clinic Report', 14, 22)
  doc.setFontSize(12)
  doc.text(`Period: ${formatDate(reportData.startDate.toISOString())} - ${formatDate(reportData.endDate.toISOString())}`, 14, 30)

  const clinicData = new Map<string, any>()

  sheets.forEach(sheet => {
    const clinic = clinics.find(c => c.id === sheet.clinic_id)
    const clinicName = clinic?.name || 'Unknown'
    
    if (!clinicData.has(clinicName)) {
      clinicData.set(clinicName, {
        name: clinicName,
        providers: new Map(),
        totalInsurance: 0,
        totalPatient: 0,
        totalAR: 0,
      })
    }

    const data = clinicData.get(clinicName)!
    const provider = users.find(u => u.id === sheet.provider_id)
    const providerName = provider?.full_name || provider?.email || 'Unknown'
    const rows = rowsBySheetId[sheet.id] || []
    
    let insurance = 0
    let patient = 0
    let ar = 0

    rows.forEach((row: SheetRow) => {
      insurance += parseFloat(row.insurance_payment as string) || 0
      patient += parseFloat(row.collected_from_patient as string) || 0
      ar += row.ar_amount || 0
    })

    data.providers.set(providerName, { insurance, patient, ar })
    data.totalInsurance += insurance
    data.totalPatient += patient
    data.totalAR += ar
  })

  let yPos = 40
  clinicData.forEach((data, clinicName) => {
    if (yPos > 250) {
      doc.addPage()
      yPos = 20
    }

    doc.setFontSize(14)
    doc.text(clinicName, 14, yPos)
    yPos += 10

    const tableData: any[] = []
    data.providers.forEach((totals: { insurance: number; patient: number; ar: number }, providerName: string) => {
      tableData.push([
        providerName,
        formatCurrency(totals.insurance),
        formatCurrency(totals.patient),
        formatCurrency(totals.ar),
        formatCurrency(totals.insurance + totals.patient + totals.ar),
      ])
    })

    tableData.push([
      'TOTAL',
      formatCurrency(data.totalInsurance),
      formatCurrency(data.totalPatient),
      formatCurrency(data.totalAR),
      formatCurrency(data.totalInsurance + data.totalPatient + data.totalAR),
    ])

    autoTable(doc, {
      head: [['Provider', 'Insurance', 'Patient', 'AR', 'Total']],
      body: tableData,
      startY: yPos,
    })

    yPos = (doc as any).lastAutoTable.finalY + 15
  })

  return doc
}

export async function generateClaimReport(
  sheets: ProviderSheet[],
  reportData: ReportData,
  rowsBySheetId: Record<string, SheetRow[]>
): Promise<jsPDF> {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.text('Claim Status Report', 14, 22)
  doc.setFontSize(12)
  doc.text(`Period: ${formatDate(reportData.startDate.toISOString())} - ${formatDate(reportData.endDate.toISOString())}`, 14, 30)

  const claimData = new Map<string, number>()

  sheets.forEach(sheet => {
    const rows = rowsBySheetId[sheet.id] || []
    rows.forEach((row: SheetRow) => {
      if (row.claim_status) {
        claimData.set(
          row.claim_status,
          (claimData.get(row.claim_status) || 0) + 1
        )
      }
    })
  })

  const tableData = Array.from(claimData.entries()).map(([status, count]) => [
    status,
    count.toString(),
  ])

  autoTable(doc, {
    head: [['Claim Status', 'Count']],
    body: tableData,
    startY: 40,
  })

  return doc
}

export async function generatePatientInvoiceReport(
  sheets: ProviderSheet[],
  reportData: ReportData,
  rowsBySheetId: Record<string, SheetRow[]>
): Promise<jsPDF> {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.text('Patient Invoice Report', 14, 22)
  doc.setFontSize(12)
  doc.text(`Period: ${formatDate(reportData.startDate.toISOString())} - ${formatDate(reportData.endDate.toISOString())}`, 14, 30)

  const tableData: any[] = []

  sheets.forEach(sheet => {
    const rows = rowsBySheetId[sheet.id] || []
    rows.forEach((row: SheetRow) => {
      if (row.invoice_amount && row.patient_pay_status && 
          ['CC declined', 'Payment Plan'].includes(row.patient_pay_status)) {
        tableData.push([
          row.patient_id || 'N/A',
          formatCurrency(row.invoice_amount),
          row.patient_pay_status,
          row.payment_date ? formatDate(row.payment_date) : 'N/A',
        ])
      }
    })
  })

  autoTable(doc, {
    head: [['Patient ID', 'Invoice Amount', 'Status', 'Payment Date']],
    body: tableData,
    startY: 40,
  })

  return doc
}

export async function generateLaborReport(
  timecards: Timecard[],
  users: User[],
  reportData: ReportData
): Promise<jsPDF> {
  const doc = new jsPDF()
  
  doc.setFontSize(18)
  doc.text('Labor Report', 14, 22)
  doc.setFontSize(12)
  doc.text(`Period: ${formatDate(reportData.startDate.toISOString())} - ${formatDate(reportData.endDate.toISOString())}`, 14, 30)

  const userData = new Map<string, { hours: number; amount: number }>()

  timecards.forEach(timecard => {
    const user = users.find(u => u.id === timecard.user_id)
    const userName = user?.full_name || user?.email || 'Unknown'
    
    if (!userData.has(userName)) {
      userData.set(userName, { hours: 0, amount: 0 })
    }

    const data = userData.get(userName)!
    data.hours += timecard.hours || 0
    data.amount += timecard.amount_paid || 0
  })

  const tableData = Array.from(userData.entries()).map(([name, data]) => [
    name,
    data.hours.toFixed(2),
    formatCurrency(data.amount),
  ])

  autoTable(doc, {
    head: [['Billing Staff', 'Hours', 'Amount Paid']],
    body: tableData,
    startY: 40,
  })

  return doc
}

export function getDateRange(filter: string): { startDate: Date; endDate: Date } {
  const now = new Date()
  let startDate: Date
  let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0) // End of current month

  switch (filter) {
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'quarter':
      const quarter = Math.floor(now.getMonth() / 3)
      startDate = new Date(now.getFullYear(), quarter * 3, 1)
      break
    case 'ytd':
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
  }

  return { startDate, endDate }
}
