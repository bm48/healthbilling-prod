import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRowsForSheetIds } from '@/lib/providerSheetRows'
import { SheetRow, Clinic, Patient, User } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { generateClinicInvoicePdf, type PaystubEntry } from '@/lib/clinicInvoicePdf'
import { fetchClinicAddressesByClinicIds } from '@/lib/clinicAddresses'
import { Download } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  patient_id: string
  patient_name: string
  clinic_name: string
  provider_name: string
  invoice_amount: number
  collected_from_patient: string | number
  patient_pay_status: string
  payment_date: string | null
  appointment_date: string | null
}

/** One row from the `invoices` table (super-admin view). */
interface InvoiceRecord {
  id: string
  clinic_id: string
  month: number
  year: number
  insurance_payment_total: number
  patient_payment_total: number
  accounts_receivable_total: number
  additional_fee: number
  subtotal: number
  invoice_rate: number | null
  invoice_total: number
  payment_status: string | null
  payment_date: string | null
  due_date: string | null
  note: string | null
  computed_at: string | null
}

/** Merged display row: invoice record + clinic display fields. */
interface ClinicInvoiceSummaryRow {
  invoice_id: string | null
  clinic_id: string
  clinic_name: string
  clinic_address_1: string
  clinic_address_2: string
  insurance_payment_total: number
  patient_payment_total: number
  accounts_receivable_total: number
  additional_fee: number
  total: number
  invoice_rate: number | null
  invoice_total: number
  payment_status: string
  payment_date: string | null
  due_date: string | null
  note: string
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseFloat(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const PAYMENT_STATUS_OPTIONS = [
  '',
  'Paid',
  'Pending',
  'Overdue',
  'Partial',
  'Waived',
]

/** Matches Provider Pay tab default when `providers.provider_cut_percent` is unset. */
const DEFAULT_PROVIDER_CUT_PERCENT = 0.7

// ── Component ─────────────────────────────────────────────────────────────

export default function Invoices() {
  const { userProfile } = useAuth()
  const isSuperAdmin = userProfile?.role === 'super_admin'

  // ── non-admin state ──────────────────────────────────────────────────────
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [selectedClinic, setSelectedClinic] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'this-month' | 'this-year'>('all')

  // ── super-admin state ────────────────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  })
  const [clinicSummaries, setClinicSummaries] = useState<ClinicInvoiceSummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)

  // ── inline edit state ────────────────────────────────────────────────────
  const [editingCell, setEditingCell] = useState<{ clinicId: string; field: 'payment_status' | 'payment_date' | 'due_date' } | null>(null)
  const [editValue, setEditValue] = useState<string>('')

  // ── note / additional fee state (super admin) ────────────────────────────
  const [invoiceNotes, setInvoiceNotes] = useState<Record<string, string>>({})
  const [invoiceAdditionalFees, setInvoiceAdditionalFees] = useState<Record<string, number>>({})
  const [selectedClinicForNote, setSelectedClinicForNote] = useState<string>('')
  const [noteText, setNoteText] = useState<string>('')
  const [additionalFeeText, setAdditionalFeeText] = useState<string>('0.00')

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchClinicsForFilter()
    if (!isSuperAdmin) fetchInvoices()
  }, [userProfile])

  useEffect(() => {
    if (isSuperAdmin) fetchClinicSummaries()
  }, [selectedMonth, isSuperAdmin, userProfile])

  useEffect(() => {
    if (!isSuperAdmin) fetchInvoices()
  }, [selectedClinic, dateFilter])

  useEffect(() => {
    setNoteText(selectedClinicForNote ? (invoiceNotes[selectedClinicForNote] ?? '') : '')
  }, [selectedClinicForNote, invoiceNotes])
  useEffect(() => {
    const fee = selectedClinicForNote ? (invoiceAdditionalFees[selectedClinicForNote] ?? 0) : 0
    setAdditionalFeeText(fee === 0 ? '0.00' : fee.toFixed(2))
  }, [selectedClinicForNote, invoiceAdditionalFees])

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  async function fetchClinicsForFilter() {
    if (!userProfile) return
    try {
      let q = apiClient.from('clinics').select('*')
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        q = q.in('id', userProfile.clinic_ids)
      }
      const { data, error } = await q.order('name')
      if (error) throw error
      setClinics(data || [])
    } catch { /* silent */ }
  }

  const fetchClinicSummaries = useCallback(async () => {
    if (!userProfile || !isSuperAdmin) return
    setSummaryLoading(true)
    try {
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()

      // Load all clinics
      const { data: allClinicsData, error: clinicsErr } = await apiClient
        .from('clinics').select('id, name, invoice_rate').order('name')
      if (clinicsErr) throw clinicsErr
      const allClinics: { id: string; name: string; invoice_rate: number | null }[] = allClinicsData || []
      const clinicIds = allClinics.map((c) => c.id)

      // Load invoice records for this month
      const { data: invoiceData } = await apiClient
        .from('invoices')
        .select('*')
        .eq('month', month)
        .eq('year', year)
      const invoiceMap = new Map<string, InvoiceRecord>(
        (invoiceData || []).map((r: InvoiceRecord) => [r.clinic_id, r]),
      )

      // Clinic addresses
      const clinicAddressesByClinic = clinicIds.length > 0
        ? await fetchClinicAddressesByClinicIds(clinicIds)
        : {}

      // Clinic invoice notes (for note + additional_fee editable display)
      const { data: notesData } = await apiClient
        .from('clinic_invoice_notes')
        .select('clinic_id, note, additional_fee')
        .eq('month', month)
        .eq('year', year)
      const notesMap: Record<string, string> = {}
      const additionalFeesMap: Record<string, number> = {}
      ;(notesData || []).forEach((r: { clinic_id: string; note: string | null; additional_fee?: number | null }) => {
        notesMap[r.clinic_id] = r.note ?? ''
        const fee = r.additional_fee != null ? Number(r.additional_fee) : 0
        additionalFeesMap[r.clinic_id] = Number.isFinite(fee) ? fee : 0
      })
      setInvoiceNotes(notesMap)
      setInvoiceAdditionalFees(additionalFeesMap)

      // Build summary rows — one per clinic
      const summaries: ClinicInvoiceSummaryRow[] = allClinics.map((clinic) => {
        const inv = invoiceMap.get(clinic.id)
        return {
          invoice_id: inv?.id ?? null,
          clinic_id: clinic.id,
          clinic_name: clinic.name,
          clinic_address_1: clinicAddressesByClinic[clinic.id]?.[0] ?? '',
          clinic_address_2: clinicAddressesByClinic[clinic.id]?.[1] ?? '',
          insurance_payment_total: parseNum(inv?.insurance_payment_total),
          patient_payment_total: parseNum(inv?.patient_payment_total),
          accounts_receivable_total: parseNum(inv?.accounts_receivable_total),
          additional_fee: parseNum(inv?.additional_fee),
          total: parseNum(inv?.subtotal),
          invoice_rate: inv?.invoice_rate ?? clinic.invoice_rate ?? null,
          invoice_total: parseNum(inv?.invoice_total),
          payment_status: inv?.payment_status ?? '',
          payment_date: inv?.payment_date ?? null,
          due_date: inv?.due_date ?? null,
          note: inv?.note ?? notesMap[clinic.id] ?? '',
        }
      })
      setClinicSummaries(summaries)
    } catch {
      setClinicSummaries([])
    } finally {
      setSummaryLoading(false)
    }
  }, [userProfile, isSuperAdmin, selectedMonth])

  async function fetchInvoices() {
    if (!userProfile) return
    setLoading(true)
    try {
      let sheetsQuery = apiClient.from('provider_sheets').select('*')
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        sheetsQuery = sheetsQuery.in('clinic_id', userProfile.clinic_ids)
      }
      if (selectedClinic !== 'all') sheetsQuery = sheetsQuery.eq('clinic_id', selectedClinic)
      const now = new Date()
      if (dateFilter === 'this-month') {
        sheetsQuery = sheetsQuery.eq('month', now.getMonth() + 1).eq('year', now.getFullYear())
      } else if (dateFilter === 'this-year') {
        sheetsQuery = sheetsQuery.eq('year', now.getFullYear())
      }
      const { data: sheetsData, error: sheetsError } = await sheetsQuery
      if (sheetsError) throw sheetsError
      const sheets = sheetsData || []
      const sheetIds = sheets.map((s: { id: string }) => s.id)
      const rowsBySheetIdMap = await fetchSheetRowsForSheetIds(apiClient, sheetIds)
      const rowsBySheet = sheets.map((s: { id: string }) => rowsBySheetIdMap.get(s.id) ?? [])
      const clinicIds = [...new Set(sheets.map((s: any) => s.clinic_id))]
      const providerIds = [...new Set(sheets.map((s: any) => s.provider_id))]
      const [clinicsData, usersData, patientsData] = await Promise.all([
        apiClient.from('clinics').select('*').in('id', clinicIds as string[]),
        apiClient.from('users').select('*').in('id', providerIds as string[]),
        apiClient.from('patients').select('*'),
      ])
      const clinicsMap = new Map<string, Clinic>((clinicsData.data || []).map((c: Clinic) => [c.id, c]))
      const usersMap = new Map<string, User>((usersData.data || []).map((u: User) => [u.id, u]))
      const patientsMap = new Map<string, Patient>(
        (patientsData.data || []).map((p: Patient) => [`${p.clinic_id}-${p.patient_id}`, p]),
      )
      const invoiceRows: InvoiceRow[] = []
      sheets.forEach((sheet: any, i: number) => {
        const clinic = clinicsMap.get(sheet.clinic_id)
        const provider = usersMap.get(sheet.provider_id)
        const rows = rowsBySheet[i] || []
        rows.forEach((row: SheetRow) => {
          if (row.invoice_amount || row.collected_from_patient) {
            const patient = row.patient_id
              ? patientsMap.get(`${sheet.clinic_id}-${row.patient_id}`)
              : null
            invoiceRows.push({
              id: `${sheet.id}-${row.id}`,
              patient_id: row.patient_id || '-',
              patient_name: patient ? `${patient.first_name} ${patient.last_name}` : '-',
              clinic_name: clinic?.name || '-',
              provider_name: provider?.full_name || provider?.email || '-',
              invoice_amount: row.invoice_amount || 0,
              collected_from_patient: row.collected_from_patient || 0,
              patient_pay_status: row.patient_pay_status || '-',
              payment_date: row.payment_date || null,
              appointment_date: row.appointment_date || null,
            })
          }
        })
      })
      setInvoices(invoiceRows)
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }

  // ── Inline edit helpers ───────────────────────────────────────────────────

  function startEdit(clinicId: string, field: 'payment_status' | 'payment_date' | 'due_date', currentValue: string) {
    setEditingCell({ clinicId, field })
    setEditValue(currentValue ?? '')
  }

  async function commitEdit(clinicId: string, field: 'payment_status' | 'payment_date' | 'due_date') {
    setEditingCell(null)
    const row = clinicSummaries.find((r) => r.clinic_id === clinicId)
    if (!row) return

    const updatePayload: Record<string, string | null> = {
      [field]: editValue || null,
      updated_at: new Date().toISOString(),
    }

    if (row.invoice_id) {
      await apiClient.from('invoices').update(updatePayload).eq('id', row.invoice_id)
    } else {
      // No invoice record yet — trigger a recompute first, then update
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      const token = (apiClient as any)._session?.access_token ?? ''
      const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
      await fetch(`${base}/api/upsert-clinic-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, month, year }),
      })
      const { data } = await apiClient.from('invoices').select('id').eq('clinic_id', clinicId).eq('month', month).eq('year', year).maybeSingle()
      if (data?.id) {
        await apiClient.from('invoices').update(updatePayload).eq('id', data.id)
      }
    }

    // Optimistic update in local state
    setClinicSummaries((prev) =>
      prev.map((r) =>
        r.clinic_id === clinicId ? { ...r, [field]: editValue || null } : r,
      ),
    )
  }

  // ── Note / additional fee save ────────────────────────────────────────────

  async function handleSaveNote() {
    if (!selectedClinicForNote) return
    const month = selectedMonth.getMonth() + 1
    const year = selectedMonth.getFullYear()
    const additionalFee = parseFloat(String(additionalFeeText).replace(/[$,]/g, '')) || 0

    const { error } = await apiClient.from('clinic_invoice_notes').upsert(
      { clinic_id: selectedClinicForNote, month, year, note: noteText, additional_fee: additionalFee, updated_at: new Date().toISOString() },
      { onConflict: 'clinic_id,month,year' },
    )
    if (error) { alert('Failed to save note.'); return }

    setInvoiceNotes((prev) => ({ ...prev, [selectedClinicForNote]: noteText }))
    setInvoiceAdditionalFees((prev) => ({ ...prev, [selectedClinicForNote]: additionalFee }))

    // Trigger server-side recompute so `invoices` row picks up new additional_fee/note
    const token = (apiClient as any)._session?.access_token ?? ''
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
    fetch(`${base}/api/upsert-clinic-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId: selectedClinicForNote, month, year }),
    }).then(() => fetchClinicSummaries()).catch(() => { /* silent */ })
  }

  // ── PDF download ──────────────────────────────────────────────────────────

  async function handleDownloadClinicInvoice(row: ClinicInvoiceSummaryRow) {
    try {
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()

      // Fetch provider sheets for this clinic/month to build paystubs
      const { data: sheetsData } = await apiClient
        .from('provider_sheets')
        .select('id, provider_id')
        .eq('clinic_id', row.clinic_id)
        .eq('month', month)
        .eq('year', year)
      const sheets: { id: string; provider_id: string }[] = sheetsData || []

      // Fetch provider (user) info
      const providerIds = [...new Set(sheets.map((s) => s.provider_id))]
      const { data: usersData } = await apiClient
        .from('users')
        .select('id, full_name, email')
        .in('id', providerIds)
      const usersMap = new Map<string, { full_name: string | null; email: string }>(
        (usersData || []).map((u: any) => [u.id, u]),
      )

      const { data: providersData } = await apiClient
        .from('providers')
        .select('id, first_name, last_name, provider_cut_percent')
        .in('id', providerIds)
      const providersMap = new Map<
        string,
        { first_name: string; last_name: string; provider_cut_percent: number | null }
      >((providersData || []).map((p: any) => [p.id, p]))

      // Fetch provider_pay for each provider this month
      const { data: ppData } = await apiClient
        .from('provider_pay')
        .select('id, provider_id, pay_date, pay_period')
        .eq('clinic_id', row.clinic_id)
        .eq('month', month)
        .eq('year', year)
      const ppMap = new Map<string, { id: string; pay_date: string | null; pay_period: string | null }>(
        (ppData || []).map((p: any) => [p.provider_id, p]),
      )

      // Fetch provider_pay_rows for all provider_pay ids
      const ppIds = (ppData || []).map((p: any) => p.id)
      let ppRowsMap = new Map<string, { row_index: number; description: string | null; amount: string | null }[]>()
      if (ppIds.length > 0) {
        const { data: ppRowsData } = await apiClient
          .from('provider_pay_rows')
          .select('provider_pay_id, row_index, description, amount')
          .in('provider_pay_id', ppIds)
          .order('row_index')
        ;(ppRowsData || []).forEach((r: any) => {
          const arr = ppRowsMap.get(r.provider_pay_id) ?? []
          arr.push(r)
          ppRowsMap.set(r.provider_pay_id, arr)
        })
      }

      // Fetch sheet rows to compute amounts when no provider_pay data exists
      const sheetIds = sheets.map((s) => s.id)
      const rowsBySheetIdMap = sheetIds.length > 0
        ? await fetchSheetRowsForSheetIds(apiClient, sheetIds)
        : new Map<string, SheetRow[]>()

      // YTD: fetch all prior months in same year for provider cut totals
      const { data: ytdSheetsData } = await apiClient
        .from('provider_pay')
        .select('id, provider_id, month')
        .eq('clinic_id', row.clinic_id)
        .eq('year', year)
        .lt('month', month)
      const ytdPpIds = (ytdSheetsData || []).map((p: any) => p.id)
      const ytdByProvider = new Map<string, number>()
      if (ytdPpIds.length > 0) {
        const { data: ytdRowsData } = await apiClient
          .from('provider_pay_rows')
          .select('provider_pay_id, row_index, description, amount')
          .in('provider_pay_id', ytdPpIds)
          .eq('row_index', 6) // Provider Cut row
        ;(ytdRowsData || []).forEach((r: any) => {
          const pp = (ytdSheetsData || []).find((p: any) => p.id === r.provider_pay_id)
          if (!pp) return
          const cut = parseNum(r.amount)
          ytdByProvider.set(pp.provider_id, (ytdByProvider.get(pp.provider_id) ?? 0) + cut)
        })
      }

      const { data: clinicData } = await apiClient.from('clinics').select('phone, ein').eq('id', row.clinic_id).maybeSingle()
      const clinicPhone2 = clinicData?.phone ?? ''
      const clinicEin = clinicData?.ein ?? ''

      // Build paystub entries — one per unique provider
      const defaultPayDate = new Date(year, month, 15) // 15th of next month
      const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })
      const payPeriod = `${monthName} ${year}`
      const clinicAddress = [row.clinic_address_1, row.clinic_address_2].filter(Boolean).join('\n')

      const paystubs: PaystubEntry[] = []
      let empIndex = 1
      const providerIdsForPdf = [...providerIds].sort((a, b) => {
        const nameA = (usersMap.get(a)?.full_name || usersMap.get(a)?.email || '').toLowerCase()
        const nameB = (usersMap.get(b)?.full_name || usersMap.get(b)?.email || '').toLowerCase()
        return nameA.localeCompare(nameB)
      })

      for (const pid of providerIdsForPdf) {
        const userInfo = usersMap.get(pid)
        const provRecord = providersMap.get(pid)
        const providerName = provRecord
          ? `${provRecord.first_name} ${provRecord.last_name}`.trim()
          : userInfo?.full_name || userInfo?.email || 'Unknown'
        const cutPercentRaw = provRecord?.provider_cut_percent
        const cutPercent =
          cutPercentRaw != null &&
          Number.isFinite(Number(cutPercentRaw)) &&
          Number(cutPercentRaw) >= 0 &&
          Number(cutPercentRaw) <= 1
            ? Number(cutPercentRaw)
            : DEFAULT_PROVIDER_CUT_PERCENT

        const pp = ppMap.get(pid)
        const ppRows = pp ? (ppRowsMap.get(pp.id) ?? []) : []

        // Provider Pay rows: 1 = Patient, 2 = Insurance, 3 = A/R
        const getAmount = (rowIdx: number) => {
          const r = ppRows.find((x) => x.row_index === rowIdx)
          return parseNum(r?.amount)
        }
        const patientPay = getAmount(1)
        const insurancePay = getAmount(2)
        const arPay = getAmount(3)

        // Fallback: sum provider_sheet_rows when Provider Pay not saved
        let fallbackIns = 0, fallbackPatient = 0, fallbackAR = 0
        if (ppRows.length === 0) {
          const providerSheets = sheets.filter((s) => s.provider_id === pid)
          for (const ps of providerSheets) {
            const rows = rowsBySheetIdMap.get(ps.id) ?? []
            rows.forEach((r: SheetRow) => {
              fallbackIns += parseNum(r.insurance_payment)
              fallbackPatient += parseNum(r.collected_from_patient)
              fallbackAR += parseNum(r.ar_amount)
            })
          }
        }

        // Collected: month row = Insurance + Patient; AR row = A/R only (same as Provider Pay box)
        const monthCollected = ppRows.length > 0 ? insurancePay + patientPay : fallbackIns + fallbackPatient
        const arCollected = ppRows.length > 0 ? arPay : fallbackAR
        // Total owed = collected × provider cut % (60%, 70%, etc.)
        const monthOwed = monthCollected * cutPercent
        const arOwed = arCollected * cutPercent
        const directDeposit = monthOwed + arOwed

        let payDateStr = `${String(defaultPayDate.getMonth() + 1).padStart(2, '0')}/${String(defaultPayDate.getDate()).padStart(2, '0')}/${defaultPayDate.getFullYear()}`
        if (pp?.pay_date) {
          try {
            const d = new Date(pp.pay_date + 'T00:00:00')
            payDateStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
          } catch { /* keep default */ }
        }

        const ytdPrior = ytdByProvider.get(pid) ?? 0
        const ytdTotal = ytdPrior + directDeposit

        paystubs.push({
          provider_name: providerName,
          emp_id: String(empIndex).padStart(3, '0'),
          stub_no: String(year).slice(2) + String(month).padStart(2, '0') + String(empIndex).padStart(2, '0'),
          pay_period: payPeriod,
          pay_date: payDateStr,
          clinic_name: row.clinic_name,
          clinic_address: clinicAddress,
          clinic_phone: clinicPhone2,
          clinic_ein: clinicEin,
          month_amount_collected: monthCollected,
          month_total_owed: monthOwed,
          ar_amount_collected: arCollected,
          ar_total_owed: arOwed,
          ytd: ytdTotal,
          direct_deposit_amount: directDeposit,
        })
        empIndex++
        break // PDF includes only one earnings-statement page
      }

      const pdfRow = {
        ...row,
        note: invoiceNotes[row.clinic_id] ?? row.note ?? '',
        additional_fee: invoiceAdditionalFees[row.clinic_id] ?? row.additional_fee ?? 0,
      }
      const pdf = await generateClinicInvoicePdf(pdfRow, selectedMonth, paystubs)
      const monthStr = `${year}-${String(month).padStart(2, '0')}`
      pdf.save(`Invoice_${row.clinic_name.replace(/[^a-z0-9-_]/gi, '_')}_${monthStr}.pdf`)
    } catch (e) {
      console.error(e)
      alert('Failed to generate PDF.')
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalInvoiceAmount = invoices.reduce((s, inv) => s + (inv.invoice_amount || 0), 0)
  const totalCollected = invoices.reduce((s, inv) => {
    const v = typeof inv.collected_from_patient === 'string'
      ? parseFloat(inv.collected_from_patient) || 0
      : inv.collected_from_patient || 0
    return s + v
  }, 0)
  const totalOutstanding = totalInvoiceAmount - totalCollected
  const months = Array.from({ length: 12 }, (_, i) => i)
  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i)

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderEditableCell(
    row: ClinicInvoiceSummaryRow,
    field: 'payment_status' | 'payment_date' | 'due_date',
    displayValue: string,
  ) {
    const isEditing = editingCell?.clinicId === row.clinic_id && editingCell?.field === field

    if (isEditing) {
      if (field === 'payment_status') {
        return (
          <select
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitEdit(row.clinic_id, field)}
            className="px-1 py-0.5 text-sm bg-white text-black rounded border border-blue-400 w-full"
          >
            {PAYMENT_STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt || '—'}</option>
            ))}
          </select>
        )
      }
      return (
        <input
          autoFocus
          type="date"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => commitEdit(row.clinic_id, field)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(row.clinic_id, field) }}
          className="px-1 py-0.5 text-sm bg-white text-black rounded border border-blue-400 w-full"
        />
      )
    }

    return (
      <span
        role="button"
        tabIndex={0}
        title="Click to edit"
        onClick={() => startEdit(row.clinic_id, field, displayValue)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') startEdit(row.clinic_id, field, displayValue) }}
        className="cursor-pointer hover:bg-white/10 rounded px-1 py-0.5 min-w-[60px] inline-block"
      >
        {displayValue || <span className="text-white/30 italic text-xs">click to set</span>}
      </span>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Invoices</h1>
      </div>

      {isSuperAdmin ? (
        <>
          {/* Month/year selector + Sync button */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 mb-6 border border-white/20">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Month</label>
                <select
                  value={selectedMonth.getMonth()}
                  onChange={(e) => {
                    const next = new Date(selectedMonth)
                    next.setMonth(Number(e.target.value))
                    setSelectedMonth(next)
                  }}
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                >
                  {months.map((m) => (
                    <option key={m} value={m} className="bg-slate-900">
                      {new Date(2000, m, 1).toLocaleString('en-US', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Year</label>
                <select
                  value={selectedMonth.getFullYear()}
                  onChange={(e) => {
                    const next = new Date(selectedMonth)
                    next.setFullYear(Number(e.target.value))
                    setSelectedMonth(next)
                  }}
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                >
                  {years.map((y) => (
                    <option key={y} value={y} className="bg-slate-900">{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Super-admin clinic summary table */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20">
            <div className="p-6">
              {summaryLoading ? (
                <div className="text-center py-8 text-white/70">Loading…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-spreadsheet w-full text-sm [&_td]:text-gray-900 [&_th]:text-white">
                    <thead>
                      <tr>
                        <th>Clinic</th>
                        <th>Ins Pay Total</th>
                        <th>PP Total</th>
                        <th>AR Total</th>
                        <th>Addl Fee</th>
                        <th>Total</th>
                        <th>Invoice Total</th>
                        <th>Payment Status ✏️</th>
                        <th>Payment Date ✏️</th>
                        <th>Due Date ✏️</th>
                        <th>Note</th>
                        <th className="w-16">PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clinicSummaries.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="text-center text-white/70 py-8">
                            No data for this month — save a provider sheet or add invoice notes to populate totals.
                          </td>
                        </tr>
                      ) : (
                        clinicSummaries.map((row) => (
                          <tr key={row.clinic_id}>
                            <td className="text-white/90 font-medium whitespace-nowrap">{row.clinic_name}</td>
                            <td>{formatCurrency(row.insurance_payment_total)}</td>
                            <td>{formatCurrency(row.patient_payment_total)}</td>
                            <td>{formatCurrency(row.accounts_receivable_total)}</td>
                            <td>{formatCurrency(row.additional_fee)}</td>
                            <td>{formatCurrency(row.total)}</td>
                            <td>{formatCurrency(row.invoice_total)}</td>
                            <td>
                              {renderEditableCell(row, 'payment_status', row.payment_status ?? '')}
                            </td>
                            <td>
                              {renderEditableCell(
                                row,
                                'payment_date',
                                row.payment_date
                                  ? row.payment_date.slice(0, 10)
                                  : '',
                              )}
                            </td>
                            <td>
                              {renderEditableCell(
                                row,
                                'due_date',
                                row.due_date
                                  ? row.due_date.slice(0, 10)
                                  : '',
                              )}
                            </td>
                            <td className="max-w-[160px] truncate text-white/70" title={row.note}>
                              {row.note || '—'}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleDownloadClinicInvoice(row)}
                                className="p-1.5 text-black hover:bg-gray-200/60 rounded inline-flex items-center justify-center"
                                title="Download invoice PDF (with provider paystub)"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Note / additional fee editor */}
              <div className="mt-6 p-4 bg-white/5 rounded-lg border border-white/20">
                <div className="flex flex-row items-center justify-center gap-4">
                  <div className="w-[60%]">
                    <label className="block text-sm font-medium text-white/70 mb-2">Select clinic</label>
                    <select
                      value={selectedClinicForNote}
                      onChange={(e) => setSelectedClinicForNote(e.target.value)}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                    >
                      <option value="" className="bg-slate-900">Select clinic…</option>
                      {clinicSummaries.map((row) => (
                        <option key={row.clinic_id} value={row.clinic_id} className="bg-slate-900">
                          {row.clinic_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-[40%] flex items-end justify-end mt-4">
                    <button
                      type="button"
                      onClick={handleSaveNote}
                      disabled={!selectedClinicForNote}
                      className="mt-2 px-4 py-2 bg-white/20 hover:bg-white/30 disabled:opacity-50 disabled:pointer-events-none border border-white/20 rounded-lg text-white text-sm"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">Additional fee ($)</label>
                    <input
                      type="text"
                      value={additionalFeeText}
                      onChange={(e) => setAdditionalFeeText(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 backdrop-blur-sm"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-white/70 mb-2">Add note</label>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Enter note for this clinic's invoice…"
                    rows={3}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 backdrop-blur-sm resize-y"
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Non–super-admin: filters + line-item table */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 mb-6 border border-white/20">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Clinic</label>
                <select
                  value={selectedClinic}
                  onChange={(e) => setSelectedClinic(e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                >
                  <option value="all">All Clinics</option>
                  {clinics.map((c) => (
                    <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Date Filter</label>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as any)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                >
                  <option value="all" className="bg-slate-900">All Time</option>
                  <option value="this-month" className="bg-slate-900">This Month</option>
                  <option value="this-year" className="bg-slate-900">This Year</option>
                </select>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-4 mt-6">
              <div className="bg-white/5 rounded-lg p-4 border border-white/20">
                <div className="text-sm text-white/70 mb-1">Total Invoiced</div>
                <div className="text-2xl font-bold text-white">{formatCurrency(totalInvoiceAmount)}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/20">
                <div className="text-sm text-white/70 mb-1">Total Collected</div>
                <div className="text-2xl font-bold text-green-400">{formatCurrency(totalCollected)}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 border border-white/20">
                <div className="text-sm text-white/70 mb-1">Outstanding</div>
                <div className="text-2xl font-bold text-orange-400">{formatCurrency(totalOutstanding)}</div>
              </div>
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20">
            <div className="p-6">
              {loading ? (
                <div className="text-center py-8 text-white/70">Loading invoices…</div>
              ) : (
                <div className="table-container">
                  <table className="table-spreadsheet [&_td]:text-gray-900 [&_th]:text-white">
                    <thead>
                      <tr>
                        <th>Patient ID</th>
                        <th>Patient Name</th>
                        <th>Clinic</th>
                        <th>Provider</th>
                        <th>Appointment Date</th>
                        <th>Invoice Amount</th>
                        <th>Collected</th>
                        <th>Payment Status</th>
                        <th>Payment Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center text-white/70 py-8">No invoices found</td>
                        </tr>
                      ) : (
                        invoices.map((invoice) => (
                          <tr key={invoice.id}>
                            <td>{invoice.patient_id}</td>
                            <td>{invoice.patient_name}</td>
                            <td>{invoice.clinic_name}</td>
                            <td>{invoice.provider_name}</td>
                            <td>{formatDate(invoice.appointment_date) || '-'}</td>
                            <td>{formatCurrency(invoice.invoice_amount)}</td>
                            <td>{formatCurrency(invoice.collected_from_patient)}</td>
                            <td>
                              <span className="status-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff' }}>
                                {invoice.patient_pay_status}
                              </span>
                            </td>
                            <td>{formatDate(invoice.payment_date) || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
