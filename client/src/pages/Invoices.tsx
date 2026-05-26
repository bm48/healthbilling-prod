import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRowsForSheetIds } from '@/lib/providerSheetRows'
import { SheetRow, Clinic, Patient, User } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { generateClinicInvoicePdf, formatInvoicePdfDate, type PaystubEntry } from '@/lib/clinicInvoicePdf'
import { fetchClinicAddressesByClinicIds } from '@/lib/clinicAddresses'
import { Download } from 'lucide-react'
import { recomputeInvoicesForMonth, upsertClinicInvoice } from '@/lib/invoiceApi'
import { DateOfServiceTableCell } from '@/components/DateOfServiceTableCell'

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

/** Matches Provider Pay tab default when `providers.provider_cut_percent` is unset. */
const DEFAULT_PROVIDER_CUT_PERCENT = 0.7

const PP_ROW_PATIENT = 1
const PP_ROW_INSURANCE = 2
const PP_ROW_AR = 3

type PayRowLite = {
  row_index: number
  amount: string | null
  /** Only populated for rows used in paystub Adjustments rendering; safe to ignore elsewhere. */
  description?: string | null
  notes?: string | null
}

/**
 *  Row range for "Paystub Additional Pay" entries that flow into the paystub PDF. Row 7 is a
 *  read-only section header in the Provider Pay grid (see ROW_PAYSTUB_ADDITIONAL_HEADER in
 *  ProviderPayTab.tsx); rows 8..16 (inclusive) are the editable slots. Anything outside this
 *  range is workspace and must NOT appear on the provider's paystub.
 */
const PP_ROW_ADJUSTMENTS_START = 8
const PP_ROW_ADJUSTMENTS_END = 16

function payRowAmount(ppRows: PayRowLite[], rowIdx: number): number {
  const r = ppRows.find((x) => x.row_index === rowIdx)
  return parseNum(r?.amount)
}

function resolveCutPercent(providerCutPercent: number | null | undefined): number {
  const raw = providerCutPercent
  if (
    raw != null &&
    Number.isFinite(Number(raw)) &&
    Number(raw) >= 0 &&
    Number(raw) <= 1
  ) {
    return Number(raw)
  }
  return DEFAULT_PROVIDER_CUT_PERCENT
}

function providerMonthAmounts(
  providerId: string,
  monthNum: number,
  cutPercent: number,
  ppHeaders: { id: string; provider_id: string; month: number }[],
  ppRowsByPayId: Map<string, PayRowLite[]>,
  sheets: { id: string; provider_id: string; month: number }[],
  rowsBySheetId: Map<string, SheetRow[]>,
): {
  monthCollected: number
  arCollected: number
  monthOwed: number
  arOwed: number
  directDeposit: number
} {
  const ppForMonth = ppHeaders.filter((p) => p.provider_id === providerId && p.month === monthNum)
  let patient = 0
  let insurance = 0
  let ar = 0

  if (ppForMonth.length > 0) {
    for (const pp of ppForMonth) {
      const rows = ppRowsByPayId.get(pp.id) ?? []
      patient += payRowAmount(rows, PP_ROW_PATIENT)
      insurance += payRowAmount(rows, PP_ROW_INSURANCE)
      ar += payRowAmount(rows, PP_ROW_AR)
    }
  } else {
    for (const ps of sheets.filter((s) => s.provider_id === providerId && s.month === monthNum)) {
      for (const r of rowsBySheetId.get(ps.id) ?? []) {
        insurance += parseNum(r.insurance_payment)
        patient += parseNum(r.collected_from_patient)
        ar += parseNum(r.ar_amount)
      }
    }
  }

  const monthCollected = insurance + patient
  const arCollected = ar
  const monthOwed = monthCollected * cutPercent
  const arOwed = arCollected * cutPercent
  return {
    monthCollected,
    arCollected,
    monthOwed,
    arOwed,
    directDeposit: monthOwed + arOwed,
  }
}

/** Sum of "Paystub Additional Pay" amounts (rows PP_ROW_ADJUSTMENTS_START..END with non-empty
 *  Description) across all provider_pay headers for a provider+month. Used so the YTD math on the
 *  paystub matches the table's grand Total Owed (which includes adjustments). */
function adjustmentsTotalForProviderMonth(
  providerId: string,
  monthNum: number,
  ppHeaders: { id: string; provider_id: string; month: number }[],
  ppRowsByPayId: Map<string, PayRowLite[]>,
): number {
  let sum = 0
  for (const h of ppHeaders) {
    if (h.provider_id !== providerId || h.month !== monthNum) continue
    const rows = ppRowsByPayId.get(h.id) ?? []
    for (const r of rows) {
      if (r.row_index < PP_ROW_ADJUSTMENTS_START || r.row_index > PP_ROW_ADJUSTMENTS_END) continue
      const desc = (r.description ?? '').trim()
      if (desc.length === 0) continue
      sum += parseNum(r.amount)
    }
  }
  return sum
}

/** Total owed for one provider in one month — regular monthCollected/arCollected × cut % plus the
 *  "Paystub Additional Pay" rows. Used both per-month for "Total Owed" on the paystub table and
 *  rolled up to YTD. */
function totalOwedForProviderMonth(
  providerId: string,
  monthNum: number,
  cutPercent: number,
  ppHeaders: { id: string; provider_id: string; month: number }[],
  ppRowsByPayId: Map<string, PayRowLite[]>,
  sheets: { id: string; provider_id: string; month: number }[],
  rowsBySheetId: Map<string, SheetRow[]>,
): number {
  const base = providerMonthAmounts(
    providerId,
    monthNum,
    cutPercent,
    ppHeaders,
    ppRowsByPayId,
    sheets,
    rowsBySheetId,
  ).directDeposit
  return base + adjustmentsTotalForProviderMonth(providerId, monthNum, ppHeaders, ppRowsByPayId)
}

/** Sum of total owed from January through `throughMonth` (inclusive). */
function ytdTotalOwedThroughMonth(
  providerId: string,
  throughMonth: number,
  cutPercent: number,
  ppHeaders: { id: string; provider_id: string; month: number }[],
  ppRowsByPayId: Map<string, PayRowLite[]>,
  sheets: { id: string; provider_id: string; month: number }[],
  rowsBySheetId: Map<string, SheetRow[]>,
): number {
  let sum = 0
  for (let m = 1; m <= throughMonth; m++) {
    sum += totalOwedForProviderMonth(
      providerId,
      m,
      cutPercent,
      ppHeaders,
      ppRowsByPayId,
      sheets,
      rowsBySheetId,
    )
  }
  return sum
}

/** Six-digit stub number from PDF download time + per-stub sequence (unique within one download). */
function generatePaystubStubNo(downloadedAt: Date, sequenceIndex: number): string {
  const t = downloadedAt.getTime()
  const y = downloadedAt.getFullYear()
  const mo = downloadedAt.getMonth() + 1
  const d = downloadedAt.getDate()
  const h = downloadedAt.getHours()
  const mi = downloadedAt.getMinutes()
  const s = downloadedAt.getSeconds()
  const ms = downloadedAt.getMilliseconds()
  const mixed =
    (t % 1_000_007) +
    y * 17 +
    mo * 1_003 +
    d * 7_919 +
    h * 13_871 +
    mi * 97 +
    s * 1_009 +
    ms * 31 +
    sequenceIndex * 100_003
  return String(mixed % 1_000_000).padStart(6, '0')
}

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

      // Sync `invoices` from provider sheets for the selected month before reading.
      await recomputeInvoicesForMonth(month, year).catch((err) => {
        console.warn('[Invoices] recompute for month failed:', err)
      })

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

  async function saveInvoiceDateField(
    clinicId: string,
    field: 'payment_date' | 'due_date',
    stored: string | null,
  ) {
    const row = clinicSummaries.find((r) => r.clinic_id === clinicId)
    if (!row) return
    if (row[field] === stored) return

    const updatePayload: Record<string, string | null> = {
      [field]: stored,
      updated_at: new Date().toISOString(),
    }

    if (row.invoice_id) {
      await apiClient.from('invoices').update(updatePayload).eq('id', row.invoice_id)
    } else {
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      await upsertClinicInvoice(clinicId, month, year)
      const { data } = await apiClient
        .from('invoices')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('month', month)
        .eq('year', year)
        .maybeSingle()
      if (data?.id) {
        await apiClient.from('invoices').update(updatePayload).eq('id', data.id)
      }
    }

    setClinicSummaries((prev) =>
      prev.map((r) => (r.clinic_id === clinicId ? { ...r, [field]: stored } : r)),
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

    fetchClinicSummaries().catch(() => { /* silent */ })
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

      // Provider Pay + sheets Jan–current month (YTD and current-month owed use same sources)
      const { data: ytdPpData } = await apiClient
        .from('provider_pay')
        .select('id, provider_id, month')
        .eq('clinic_id', row.clinic_id)
        .eq('year', year)
        .lte('month', month)
      const ytdPpHeaders = (ytdPpData || []) as {
        id: string
        provider_id: string
        month: number
      }[]
      const ytdPpIds = ytdPpHeaders.map((p) => p.id)
      const ytdPpRowsMap = new Map<string, PayRowLite[]>()
      if (ytdPpIds.length > 0) {
        const { data: ytdPpRowsData } = await apiClient
          .from('provider_pay_rows')
          .select('provider_pay_id, row_index, amount, description, notes')
          .in('provider_pay_id', ytdPpIds)
          .order('row_index')
        ;(ytdPpRowsData || []).forEach((r: { provider_pay_id: string; row_index: number; amount: string | null; description: string | null; notes: string | null }) => {
          const arr = ytdPpRowsMap.get(r.provider_pay_id) ?? []
          arr.push({ row_index: r.row_index, amount: r.amount, description: r.description, notes: r.notes })
          ytdPpRowsMap.set(r.provider_pay_id, arr)
        })
      }

      // Per-provider adjustments for the current month (paystub-only): collect rows ONLY from the
      // dedicated "Paystub Additional Pay" slots (PP_ROW_ADJUSTMENTS_START..PP_ROW_ADJUSTMENTS_END)
      // whose Description is non-empty, across all provider_pay headers for the month (handles
      // payroll=2 → two headers per month). Rows outside that range are workspace and never appear
      // on the provider's paystub, even if a user typed a Description there.
      const adjustmentsByProvider = new Map<string, Array<{ description: string; amount: number; notes: string }>>()
      for (const h of ytdPpHeaders) {
        if (h.month !== month) continue
        const rows = ytdPpRowsMap.get(h.id) ?? []
        for (const r of rows) {
          if (r.row_index < PP_ROW_ADJUSTMENTS_START || r.row_index > PP_ROW_ADJUSTMENTS_END) continue
          const desc = (r.description ?? '').trim()
          if (desc.length === 0) continue
          const amt = parseNum(r.amount)
          const list = adjustmentsByProvider.get(h.provider_id) ?? []
          list.push({ description: desc, amount: amt, notes: (r.notes ?? '').trim() })
          adjustmentsByProvider.set(h.provider_id, list)
        }
      }

      const { data: ytdSheetsData } = await apiClient
        .from('provider_sheets')
        .select('id, provider_id, month')
        .eq('clinic_id', row.clinic_id)
        .eq('year', year)
        .lte('month', month)
      const ytdSheets = (ytdSheetsData || []) as { id: string; provider_id: string; month: number }[]
      const ytdSheetIds = ytdSheets.map((s) => s.id)
      const ytdRowsBySheetId =
        ytdSheetIds.length > 0
          ? await fetchSheetRowsForSheetIds(apiClient, ytdSheetIds)
          : new Map<string, SheetRow[]>()

      const { data: clinicData } = await apiClient
        .from('clinics')
        .select('phone, ein, paystub_logo_url, paystub_accent_color')
        .eq('id', row.clinic_id)
        .maybeSingle()
      const clinicPhone2 = clinicData?.phone ?? ''
      const clinicEin = clinicData?.ein ?? ''
      const clinicPaystubAccent: string | null = (clinicData as { paystub_accent_color?: string | null } | null)?.paystub_accent_color ?? null
      // Fetch the clinic-specific paystub logo as a data URL once per invoice so every paystub
      // page reuses it without re-downloading. NULL on any failure → renders no logo (per Jenali:
      // "if there isn't a logo uploaded, nothing — not the American Medical Billing Logo").
      const clinicLogoSource: string | null = (clinicData as { paystub_logo_url?: string | null } | null)?.paystub_logo_url ?? null
      let clinicLogoDataUrl: string | null = null
      if (clinicLogoSource) {
        try {
          if (clinicLogoSource.startsWith('data:')) {
            clinicLogoDataUrl = clinicLogoSource
          } else {
            const resp = await fetch(clinicLogoSource)
            if (resp.ok) {
              const blob = await resp.blob()
              clinicLogoDataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
                reader.onerror = () => reject(reader.error)
                reader.readAsDataURL(blob)
              })
            }
          }
        } catch (e) {
          console.warn('[Invoices] failed to load clinic paystub logo, falling back to no logo:', e)
          clinicLogoDataUrl = null
        }
      }

      // Build paystub entries — one per unique provider
      const invoicePayDateStr = formatInvoicePdfDate(row.payment_date)
      const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' })
      const payPeriod = `${monthName} ${year}`
      const clinicAddress = [row.clinic_address_1, row.clinic_address_2].filter(Boolean).join('\n')

      const paystubs: PaystubEntry[] = []
      const downloadedAt = new Date()
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
        const cutPercent = resolveCutPercent(provRecord?.provider_cut_percent)

        const {
          monthCollected,
          arCollected,
          monthOwed,
          arOwed,
          directDeposit,
        } = providerMonthAmounts(
          pid,
          month,
          cutPercent,
          ytdPpHeaders,
          ytdPpRowsMap,
          ytdSheets,
          ytdRowsBySheetId,
        )

        const ytdTotal = ytdTotalOwedThroughMonth(
          pid,
          month,
          cutPercent,
          ytdPpHeaders,
          ytdPpRowsMap,
          ytdSheets,
          ytdRowsBySheetId,
        )

        const adjustments = adjustmentsByProvider.get(pid) ?? []
        const adjustmentsSum = adjustments.reduce(
          (s, a) => s + (Number.isFinite(a.amount) ? a.amount : 0),
          0,
        )
        paystubs.push({
          provider_name: providerName,
          stub_no: generatePaystubStubNo(downloadedAt, empIndex - 1),
          pay_period: payPeriod,
          pay_date: invoicePayDateStr,
          clinic_name: row.clinic_name,
          clinic_address: clinicAddress,
          clinic_phone: clinicPhone2,
          clinic_ein: clinicEin,
          month_amount_collected: monthCollected,
          month_total_owed: monthOwed,
          ar_amount_collected: arCollected,
          ar_total_owed: arOwed,
          ytd: ytdTotal,
          // Fold paystub adjustments into the Direct Deposit Amount. The PDF prints the
          // adjustments inline in the main earnings table so the math is visible.
          direct_deposit_amount: directDeposit + adjustmentsSum,
          adjustments,
          clinic_logo_data_url: clinicLogoDataUrl,
          paystub_accent_color: clinicPaystubAccent,
        })
        empIndex++
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Invoices</h1>
      </div>

      {isSuperAdmin ? (
        <>
          {/* Month/year selector */}
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
                <div className="text-center py-8 text-white/70">Updating invoice totals…</div>
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
                        <th className="w-[90px]">Payment Date</th>
                        <th className="w-[90px]">Due Date</th>
                        <th>Note</th>
                        <th className="w-16">PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clinicSummaries.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="text-center text-white/70 py-8">
                            No clinics found.
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
                            <td className="w-[90px] p-0">
                              <DateOfServiceTableCell
                                value={row.payment_date}
                                onCommit={(stored) => saveInvoiceDateField(row.clinic_id, 'payment_date', stored)}
                              />
                            </td>
                            <td className="w-[90px] p-0">
                              <DateOfServiceTableCell
                                value={row.due_date}
                                onCommit={(stored) => saveInvoiceDateField(row.clinic_id, 'due_date', stored)}
                              />
                            </td>
                            <td className="max-w-[160px] truncate text-white/70" title={row.note}>
                              {row.note || '—'}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleDownloadClinicInvoice(row)}
                                className="p-1.5 text-black hover:bg-gray-200/60 rounded inline-flex items-center justify-center"
                                title="Download invoice PDF (with provider paystubs)"
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
