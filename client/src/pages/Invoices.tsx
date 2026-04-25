import { useState, useEffect } from 'react'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRows } from '@/lib/providerSheetRows'
import { SheetRow, Clinic, Patient, User } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { generateClinicInvoicePdf } from '@/lib/clinicInvoicePdf'
import { fetchClinicAddressesByClinicIds } from '@/lib/clinicAddresses'
import { Download } from 'lucide-react'

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

/** Super admin: one row per clinic per month */
interface ClinicInvoiceSummaryRow {
  clinic_id: string
  clinic_name: string
  clinic_address_1: string
  clinic_address_2: string
  insurance_payment_total: number
  patient_payment_total: number
  accounts_receivable_total: number
  additional_fee: number
  total: number
  invoice_total: number
  invoice_rate: number | null
  payment_status: string
  payment_date: string | null
  note?: string
}

export default function Invoices() {
  const { userProfile } = useAuth()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [selectedClinic, setSelectedClinic] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'this-month' | 'this-year'>('all')
  const isSuperAdmin = userProfile?.role === 'super_admin'
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [clinicSummaries, setClinicSummaries] = useState<ClinicInvoiceSummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [invoiceNotes, setInvoiceNotes] = useState<Record<string, string>>({})
  const [invoiceAdditionalFees, setInvoiceAdditionalFees] = useState<Record<string, number>>({})
  const [selectedClinicForNote, setSelectedClinicForNote] = useState<string>('')
  const [noteText, setNoteText] = useState<string>('')
  const [additionalFeeText, setAdditionalFeeText] = useState<string>('0.00')

  useEffect(() => {
    fetchClinics()
    if (!isSuperAdmin) {
      fetchInvoices()
    } else {
      fetchClinicSummaries()
    }
  }, [userProfile, selectedClinic, dateFilter, isSuperAdmin])
  useEffect(() => {
    if (isSuperAdmin) fetchClinicSummaries()
  }, [selectedMonth, isSuperAdmin])

  useEffect(() => {
    setNoteText(selectedClinicForNote ? (invoiceNotes[selectedClinicForNote] ?? '') : '')
  }, [selectedClinicForNote, invoiceNotes])
  useEffect(() => {
    const fee = selectedClinicForNote ? (invoiceAdditionalFees[selectedClinicForNote] ?? 0) : 0
    setAdditionalFeeText(fee === 0 ? '0.00' : fee.toFixed(2))
  }, [selectedClinicForNote, invoiceAdditionalFees])

  const fetchClinics = async () => {
    if (!userProfile) return

    try {
      let query = apiClient.from('clinics').select('*')
      
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('id', userProfile.clinic_ids)
      }

      const { data, error } = await query.order('name')
      if (error) throw error
      setClinics(data || [])
    } catch (error) {
      // Error fetching clinics
    }
  }

  const fetchClinicSummaries = async () => {
    if (!userProfile || !isSuperAdmin) return
    setSummaryLoading(true)
    try {
      const month = selectedMonth.getMonth() + 1
      const year = selectedMonth.getFullYear()
      const { data: allClinicsData, error: clinicsErr } = await apiClient.from('clinics').select('id, name, invoice_rate').order('name')
      if (clinicsErr) throw clinicsErr
      const allClinics = allClinicsData || []
      const clinicIds = allClinics.map((c: { id: string }) => c.id)
      const clinicAddressesByClinic = clinicIds.length > 0 ? await fetchClinicAddressesByClinicIds(clinicIds) : {}
      const { data: sheetsData, error: sheetsError } = await apiClient
        .from('provider_sheets')
        .select('*')
        .eq('month', month)
        .eq('year', year)
      if (sheetsError) throw sheetsError
      const sheets = sheetsData || []
      const rowsBySheet = await Promise.all(sheets.map(s => fetchSheetRows(apiClient, s.id)))
      const byClinic = new Map<string, {
        insurance: number
        patient: number
        ar: number
        paymentDates: string[]
        statuses: Set<string>
      }>()
      const parseNum = (v: string | number | null | undefined): number => {
        if (v == null) return 0
        if (typeof v === 'number') return Number.isFinite(v) ? v : 0
        const n = parseFloat(String(v).replace(/[$,]/g, ''))
        return Number.isFinite(n) ? n : 0
      }
      sheets.forEach((sheet, i) => {
        const rows = rowsBySheet[i] || [] as SheetRow[]
        rows.forEach((row: SheetRow) => {
          const clinicId = sheet.clinic_id
          if (!byClinic.has(clinicId)) {
            byClinic.set(clinicId, { insurance: 0, patient: 0, ar: 0, paymentDates: [], statuses: new Set() })
          }
          const agg = byClinic.get(clinicId)!
          agg.insurance += parseNum(row.insurance_payment)
          agg.patient += parseNum(row.collected_from_patient)
          agg.ar += parseNum(row.ar_amount)
          if (row.payment_date) agg.paymentDates.push(row.payment_date)
          if (row.patient_pay_status) agg.statuses.add(row.patient_pay_status)
        })
      })
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
      const summaries: ClinicInvoiceSummaryRow[] = allClinics.map((clinic) => {
        const agg = byClinic.get(clinic.id)
        const insurance = agg?.insurance ?? 0
        const patient = agg?.patient ?? 0
        const ar = agg?.ar ?? 0
        const additionalFee = additionalFeesMap[clinic.id] ?? 0
        const total = insurance + patient + ar + additionalFee
        const rate = clinic.invoice_rate != null ? Number(clinic.invoice_rate) : 0
        const invoice_total = total * rate
        const paymentDate = agg?.paymentDates?.length
          ? [...agg.paymentDates].sort().reverse()[0]
          : null
        let paymentStatus = '—'
        if (agg?.statuses) {
          if (agg.statuses.size > 1) paymentStatus = 'Mixed'
          else if (agg.statuses.size === 1) paymentStatus = [...agg.statuses][0]
        }
        return {
          clinic_id: clinic.id,
          clinic_name: clinic.name,
          clinic_address_1: clinicAddressesByClinic[clinic.id]?.[0] ?? '',
          clinic_address_2: clinicAddressesByClinic[clinic.id]?.[1] ?? '',
          insurance_payment_total: insurance,
          patient_payment_total: patient,
          accounts_receivable_total: ar,
          additional_fee: additionalFee,
          total,
          invoice_total,
          invoice_rate: clinic.invoice_rate != null ? clinic.invoice_rate : null,
          payment_status: paymentStatus,
          payment_date: paymentDate,
        }
      })
      setClinicSummaries(summaries)
    } catch (error) {
      setClinicSummaries([])
      setInvoiceNotes({})
      setInvoiceAdditionalFees({})
    } finally {
      setSummaryLoading(false)
    }
  }

  const fetchInvoices = async () => {
    if (!userProfile) return

    setLoading(true)
    try {
      // Fetch all provider sheets
      let sheetsQuery = apiClient.from('provider_sheets').select('*')

      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        sheetsQuery = sheetsQuery.in('clinic_id', userProfile.clinic_ids)
      }

      if (selectedClinic !== 'all') {
        sheetsQuery = sheetsQuery.eq('clinic_id', selectedClinic)
      }

      // Apply date filter
      const now = new Date()
      if (dateFilter === 'this-month') {
        sheetsQuery = sheetsQuery.eq('month', now.getMonth() + 1).eq('year', now.getFullYear())
      } else if (dateFilter === 'this-year') {
        sheetsQuery = sheetsQuery.eq('year', now.getFullYear())
      }

      const { data: sheetsData, error: sheetsError } = await sheetsQuery

      if (sheetsError) throw sheetsError

      const sheets = sheetsData || []
      const rowsBySheet = await Promise.all(sheets.map(s => fetchSheetRows(apiClient, s.id)))

      // Fetch clinics and users for display
      const clinicIds = [...new Set(sheets.map(s => s.clinic_id))]
      const providerIds = [...new Set(sheets.map(s => s.provider_id))]

      const [clinicsData, usersData, patientsData] = await Promise.all([
        apiClient.from('clinics').select('*').in('id', clinicIds),
        apiClient.from('users').select('*').in('id', providerIds),
        apiClient.from('patients').select('*'),
      ])

      const clinicsMap = new Map<string, Clinic>((clinicsData.data || []).map((c: Clinic) => [c.id, c]))
      const usersMap = new Map<string, User>((usersData.data || []).map((u: User) => [u.id, u]))
      const patientsMap = new Map<string, Patient>(
        (patientsData.data || []).map((p: Patient) => [`${p.clinic_id}-${p.patient_id}`, p]),
      )

      const invoiceRows: InvoiceRow[] = []

      sheets.forEach((sheet, i) => {
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
              patient_name: patient
                ? `${patient.first_name} ${patient.last_name}`
                : '-',
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
    } catch (error) {
      // Error fetching invoices
    } finally {
      setLoading(false)
    }
  }

  const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + (inv.invoice_amount || 0), 0)
  const totalCollected = invoices.reduce((sum, inv) => {
    const collected = typeof inv.collected_from_patient === 'string' 
      ? parseFloat(inv.collected_from_patient) || 0 
      : inv.collected_from_patient || 0
    return sum + collected
  }, 0)
  const totalOutstanding = totalInvoiceAmount - totalCollected

  async function handleDownloadClinicInvoice(row: ClinicInvoiceSummaryRow) {
    try {
      const rowWithNote = { ...row, note: invoiceNotes[row.clinic_id] ?? '', additional_fee: row.additional_fee ?? 0 }
      const pdf = await generateClinicInvoicePdf(rowWithNote, selectedMonth)
      const monthStr = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`
      const safeName = row.clinic_name.replace(/[^a-z0-9-_]/gi, '_')
      pdf.save(`Invoice_${safeName}_${monthStr}.pdf`)
    } catch (e) {
      console.error(e)
      alert('Failed to generate PDF.')
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => i)
  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear()  - i)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Invoices</h1>
      </div>

      {isSuperAdmin ? (
        <>
          {/* Super admin: month selector */}
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

          {/* Super admin: clinic summary table */}
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20">
            <div className="p-6">
              {summaryLoading ? (
                <div className="text-center py-8 text-white/70">Loading...</div>
              ) : (
                <div className="table-container dark-theme">
                  <table className="table-spreadsheet dark-theme">
                    <thead>
                      <tr>
                        <th>Clinic</th>
                        <th>Ins Pay Total</th>
                        <th>PP Total</th>
                        <th>AR Total</th>
                        <th>Additional Fee</th>
                        <th>Total</th>
                        <th>Invoice Total</th>
                        <th>Payment Status</th>
                        <th>Payment Date</th>
                        <th>Note</th>
                        <th className="w-20">Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clinicSummaries.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="text-center text-white/70 py-8">
                            No data for this month
                          </td>
                        </tr>
                      ) : (
                        clinicSummaries.map((row) => (
                          <tr key={row.clinic_id}>
                            <td className="text-white/90 font-medium">{row.clinic_name}</td>
                            <td>{formatCurrency(row.insurance_payment_total)}</td>
                            <td>{formatCurrency(row.patient_payment_total)}</td>
                            <td>{formatCurrency(row.accounts_receivable_total)}</td>
                            <td>{formatCurrency(row.additional_fee)}</td>
                            <td>{formatCurrency(row.total)}</td>
                            <td>{formatCurrency(row.invoice_total)}</td>
                            <td>
                              <span className="status-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff' }}>
                                {row.payment_status}
                              </span>
                            </td>
                            <td>{formatDate(row.payment_date) || '—'}</td>
                            <td className="max-w-[200px] truncate" title={invoiceNotes[row.clinic_id] ?? ''}>
                              {invoiceNotes[row.clinic_id] ?? '—'}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleDownloadClinicInvoice(row)}
                                className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded inline-flex items-center justify-center"
                                title="Download invoice PDF"
                              >
                                <Download className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {/* Add note: select clinic + textarea (super admin only) */}
              {isSuperAdmin && (
                <div className="mt-6 p-4 bg-white/5 rounded-lg border border-white/20">
                  <div className='flex flex-row items-center justify-center gap-4'>
                    <div className='w-[60%]'>
                      <label className="block text-sm font-medium text-white/70 mb-2">Select clinic</label>
                      <select
                        value={selectedClinicForNote}
                        onChange={(e) => setSelectedClinicForNote(e.target.value)}
                        className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white backdrop-blur-sm"
                      >
                        <option value="" className="bg-slate-900">Select clinic...</option>
                        {clinicSummaries.map((row) => (
                          <option key={row.clinic_id} value={row.clinic_id} className="bg-slate-900">
                            {row.clinic_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className='w-[40%] flex items-end justify-end mt-4'>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedClinicForNote) return
                          const month = selectedMonth.getMonth() + 1
                          const year = selectedMonth.getFullYear()
                          const additionalFee = parseFloat(String(additionalFeeText).replace(/[$,]/g, '')) || 0
                          const { error } = await apiClient
                            .from('clinic_invoice_notes')
                            .upsert(
                              {
                                clinic_id: selectedClinicForNote,
                                month,
                                year,
                                note: noteText,
                                additional_fee: additionalFee,
                                updated_at: new Date().toISOString(),
                              },
                              { onConflict: 'clinic_id,month,year' }
                            )
                          if (error) {
                            console.error(error)
                            alert('Failed to save note.')
                            return
                          }
                          setInvoiceNotes((prev) => ({ ...prev, [selectedClinicForNote]: noteText }))
                          setInvoiceAdditionalFees((prev) => ({ ...prev, [selectedClinicForNote]: additionalFee }))
                          setClinicSummaries((prev) =>
                            prev.map((r) =>
                              r.clinic_id === selectedClinicForNote
                                ? { ...r, additional_fee: additionalFee, total: r.insurance_payment_total + r.patient_payment_total + r.accounts_receivable_total + additionalFee }
                                : r
                            )
                          )
                        }}
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
                    <div className="md:col-span-1 mt-4">
                      <label className="block text-sm font-medium text-white/70 mb-2">Add note</label>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Enter note for this clinic's invoice..."
                        rows={3}
                        className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 backdrop-blur-sm resize-y"
                      />
                    </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Non–super admin: existing filters and table */}
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
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id} className="bg-slate-900">
                      {clinic.name}
                    </option>
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
                <div className="text-center py-8 text-white/70">Loading invoices...</div>
              ) : (
                <div className="table-container dark-theme">
                  <table className="table-spreadsheet dark-theme">
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
                          <td colSpan={9} className="text-center text-white/70 py-8">
                            No invoices found
                          </td>
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