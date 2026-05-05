import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider, type SheetRow } from '@/types'
import { fetchSheetRowsForSheetIds } from '@/lib/providerSheetRows'
import { fetchClinicAddressesByClinicIds } from '@/lib/clinicAddresses'
import { computeBillingMetrics, type BillingMetrics } from '@/lib/billingMetrics'
import { Users, FileText, CheckSquare, DollarSign } from 'lucide-react'

interface ClinicStats {
  patientCount: number
  providerCount: number
  todoCount: number
  currentMonthTotal: number | null
}

interface ProviderCardStats {
  providerId: string
  claimsCount: number
  unpaidClaimsCount: number
  todoCount: number
  currentMonthTotal: number
  /** Billing sheet metrics for current month (admin/billing staff) */
  metrics: BillingMetrics
}

function formatCurrency(value: number | null): string {
  if (value == null) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export default function ClinicDashboard() {
  const { clinicId } = useParams<{ clinicId: string }>()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [clinicAddressLines, setClinicAddressLines] = useState<string[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [stats, setStats] = useState<ClinicStats | null>(null)
  const [providerStats, setProviderStats] = useState<ProviderCardStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clinicId || !userProfile) return
    const allowed =
      userProfile.role === 'super_admin' ||
      (userProfile.role === 'admin' && userProfile.clinic_ids?.includes(clinicId)) ||
      (userProfile.clinic_ids?.length && userProfile.clinic_ids.includes(clinicId))
    if (!allowed) {
      navigate('/dashboard', { replace: true })
      return
    }
    // Official staff only see billing tab; redirect from clinic dashboard to billing
    if (userProfile.role === 'official_staff') {
      navigate(`/clinic/${clinicId}/todo`, { replace: true })
      return
    }
    fetchData()
  }, [clinicId, userProfile, navigate])

  const fetchData = async () => {
    if (!clinicId) return
    setLoading(true)
    try {
      const { data: clinicData, error: clinicError } = await apiClient
        .from('clinics')
        .select('*')
        .eq('id', clinicId)
        .single()

      if (clinicError || !clinicData) {
        navigate('/dashboard', { replace: true })
        return
      }
      setClinic(clinicData as Clinic)
      const addressesMap = await fetchClinicAddressesByClinicIds([clinicId])
      setClinicAddressLines(addressesMap[clinicId] ?? [])

      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth() + 1
      // When clinic has payroll=2 there are two sheets per provider per month (1st/2nd half). We count only
      // payroll=1 (first half) so "Visits" matches what the user sees in the Providers tab (default is first half).
      const payroll = 1

      const [providersRes, patientsRes, todosRes, sheetsRes] = await Promise.all([
        apiClient
          .from('providers')
          .select('*')
          .eq('active', true)
          .contains('clinic_ids', [clinicId])
          .order('last_name')
          .order('first_name'),
        apiClient.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
        apiClient.from('todo_lists').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
        apiClient
          .from('provider_sheets')
          .select('id, provider_id')
          .eq('clinic_id', clinicId)
          .eq('month', m)
          .eq('year', y)
          .eq('payroll', payroll),
      ])

      const providersList = (providersRes.data || []) as Provider[]
      setProviders(providersList)

      setStats({
        patientCount: patientsRes.count ?? 0,
        providerCount: providersList.length,
        todoCount: todosRes.count ?? 0,
        currentMonthTotal: null,
      })

      const sheetsRaw = (sheetsRes.data || []) as { id: string; provider_id: string }[]
      // When duplicate sheets exist for the same (provider, month, year, payroll), use one per provider (smallest id)
      // so we count the same sheet the Providers tab shows (ClinicDetail also orders by id and takes one).
      const sheetsByProvider = new Map<string, { id: string; provider_id: string }>()
      for (const sheet of sheetsRaw) {
        const existing = sheetsByProvider.get(sheet.provider_id)
        if (!existing || sheet.id < existing.id) sheetsByProvider.set(sheet.provider_id, sheet)
      }
      const sheets = Array.from(sheetsByProvider.values())

      // Visits = number of rows in the providers tab table (provider_sheet_rows) for that provider
      if (sheets.length === 0) {
        setProviderStats(
          providersList.map((p) => ({
            providerId: p.id,
            claimsCount: 0,
            unpaidClaimsCount: 0,
            todoCount: todosRes.count ?? 0,
            currentMonthTotal: 0,
            metrics: {
              visits: 0,
              noShows: 0,
              paidClaims: 0,
              privatePay: 0,
              secondary: 0,
              ccDeclines: 0,
            },
          }))
        )
      } else {
        const sheetIds = sheets.map((s) => s.id)
        const rowsBySheetId = await fetchSheetRowsForSheetIds(apiClient, sheetIds)
        const rowsBySheet: Record<string, SheetRow[]> = {}
        for (const sheet of sheets) {
          rowsBySheet[sheet.id] = rowsBySheetId.get(sheet.id) ?? []
        }

        const byProvider: Record<string, { claims: number; unpaid: number; total: number; metrics: BillingMetrics }> = {}
        providersList.forEach((p) => {
          byProvider[p.id] = {
            claims: 0,
            unpaid: 0,
            total: 0,
            metrics: { visits: 0, noShows: 0, paidClaims: 0, privatePay: 0, secondary: 0, ccDeclines: 0 },
          }
        })

        sheets.forEach((sheet) => {
          const rows = rowsBySheet[sheet.id] || []
          const providerId = sheet.provider_id
          if (!byProvider[providerId])
            byProvider[providerId] = {
              claims: 0,
              unpaid: 0,
              total: 0,
              metrics: { visits: 0, noShows: 0, paidClaims: 0, privatePay: 0, secondary: 0, ccDeclines: 0 },
            }
          rows.forEach((row) => {
            byProvider[providerId].claims += 1
            if (row.claim_status !== 'Paid') byProvider[providerId].unpaid += 1
            const ins = parseFloat(String(row.insurance_payment)) || 0
            const pat = parseFloat(String(row.collected_from_patient)) || 0
            const ar = Number(row.ar_amount) || 0
            byProvider[providerId].total += ins + pat + ar
          })
          const metrics = computeBillingMetrics(rows)
          // Visits = row count for this sheet (same period as Providers tab default view)
          byProvider[providerId].metrics = {
            visits: rows.length,
            noShows: metrics.noShows,
            paidClaims: metrics.paidClaims,
            privatePay: metrics.privatePay,
            secondary: metrics.secondary,
            ccDeclines: metrics.ccDeclines,
          }
        })

        const providerStatsList = providersList.map((p) => ({
          providerId: p.id,
          claimsCount: byProvider[p.id]?.claims ?? 0,
          unpaidClaimsCount: byProvider[p.id]?.unpaid ?? 0,
          todoCount: todosRes.count ?? 0,
          currentMonthTotal: byProvider[p.id]?.total ?? 0,
          metrics: byProvider[p.id]?.metrics ?? { visits: 0, noShows: 0, paidClaims: 0, privatePay: 0, secondary: 0, ccDeclines: 0 },
        }))
        setProviderStats(providerStatsList)
        const grandTotalPaid = providersList.reduce((s, p) => s + (byProvider[p.id]?.total ?? 0), 0)
        setStats((prev) => (prev ? { ...prev, currentMonthTotal: grandTotalPaid } : prev))
      }
    } catch (error) {
      console.error('Error fetching clinic dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !clinic) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Section 1: Clinic name */}
      <div>
        <h1 className="text-3xl font-bold text-white">{clinic.name}</h1>
      </div>

      {/* Section 2: Clinic info card – dashboard style */}
      <div>
        <div className="space-y-3 grid grid-cols-2">
            <div>
              {clinicAddressLines.filter((line) => line.trim()).length > 0 && (
                <>
                  {clinicAddressLines.map((line, i) =>
                    line.trim() ? (
                      <div key={i} className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-white/70 font-medium">Clinic Address {i + 1}: </span>
                        <span className="text-white">{line}</span>
                      </div>
                    ) : null
                  )}
                </>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-white/70 font-medium">Phone : </span>
                <span className="text-white">{clinic.phone ?? '—'}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-white/70 font-medium">Fax : </span>
                <span className="text-white">{clinic.fax ?? '—'}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-white/70 font-medium">EIN/Tax ID : </span>
                <span className="text-white">{clinic.ein ?? '—'}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-white/70 font-medium">NPI : </span>
                <span className="text-white">{clinic.npi ?? '—'}</span>
              </div>
            </div>
            <div>
              {/* Section 3: Summary cards */}
              <div className="grid grid-cols-2 gap-6 -mt-6">
                <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
                  <div className="flex items-center justify-between mb-2">
                    <Users className="text-green-400" size={24} />
                    <span className="text-3xl font-bold text-white">{stats?.patientCount ?? 0}</span>
                  </div>
                  <h3 className="text-sm font-medium text-white/70">Patients</h3>
                </div>
                <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
                  <div className="flex items-center justify-between mb-2">
                    <FileText className="text-blue-400" size={24} />
                    <span className="text-3xl font-bold text-white">{stats?.providerCount ?? 0}</span>
                  </div>
                  <h3 className="text-sm font-medium text-white/70">Providers</h3>
                </div>
                {userProfile?.role !== 'office_staff' && (
                  <>
                  <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
                    <div className="flex items-center justify-between mb-2">
                      <CheckSquare className="text-yellow-400" size={24} />
                      <span className="text-3xl font-bold text-white">{stats?.todoCount ?? 0}</span>
                    </div>
                    <h3 className="text-sm font-medium text-white/70">To-Do Items</h3>
                  </div>
                  </>
                )}
                {(userProfile?.role !== 'billing_staff' && userProfile?.role !== 'office_staff') && (
                  <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
                    <div className="flex items-center justify-between mb-2">
                      <DollarSign className="text-purple-400" size={24} />
                      <span className="text-3xl font-bold text-white">
                        {formatCurrency(stats?.currentMonthTotal ?? 0)}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-white/70">Total $ paid (current month)</h3>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          
      </div>


      {/* Section 3b: Total $ paid (current month) per provider – summary at top */}
      {(userProfile?.role !== 'billing_staff' && userProfile?.role !== 'office_staff') && providers.length > 0 && (
        <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Total $ paid (current month) by provider</h2>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {providers.map((provider) => {
              const ps = providerStats.find((s) => s.providerId === provider.id)
              return (
                <div key={provider.id} className="text-white/90 text-sm">
                  <span className="font-medium">{provider.first_name} {provider.last_name}:</span>
                  <span className="ml-1">{formatCurrency(ps?.currentMonthTotal ?? 0)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}


      
      {/* Section 4: Provider summary cards – dashboard style (one per row) */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Providers</h2>
        <div className="space-y-4">
          {providers.map((provider) => {
            const ps = providerStats.find((s) => s.providerId === provider.id)
            return (
              <Link
                key={provider.id}
                to={`/clinic/${clinicId}/providers/${provider.id}`}
                className="block bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20 p-5 hover:border-primary-400/50 transition-colors"
              >
                <div className="space-y-2">
                  <div className="font-semibold text-white italic text-2xl">
                    {provider.first_name} {provider.last_name}
                  </div>
                  <div className="text-white/80 text-lg">
                    {provider.npi ? ` NPI : ${provider.npi}` : ''}
                  </div>
                  <div className="text-white/80 text-sm flex flex-wrap gap-x-4 gap-y-0.5 mt-1 border-t border-white/20 pt-2">
                    {userProfile?.role !== 'office_staff' && (
                      <>
                      <span>Visits: {ps?.metrics?.visits ?? 0}</span>
                      <span>No Shows: {ps?.metrics?.noShows ?? 0}</span>
                      <span>Paid claims: {ps?.metrics?.paidClaims ?? 0}</span>
                      <span>PP: {ps?.metrics?.privatePay ?? 0}</span>
                      <span>Secondary: {ps?.metrics?.secondary ?? 0}</span>
                      <span>CC Declines: {ps?.metrics?.ccDeclines ?? 0}</span>
                    </>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
        {providers.length === 0 && (
          <p className="text-white/70">No providers assigned to this clinic.</p>
        )}
      </div>
    </div>
  )
}
