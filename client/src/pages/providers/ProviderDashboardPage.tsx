import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider } from '@/types'
import { LayoutDashboard, Building2, Users } from 'lucide-react'
import ClinicCard, { ClinicCardStats } from '@/components/ClinicCard'

export default function ProviderDashboardPage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [clinicStats, setClinicStats] = useState<Record<string, ClinicCardStats>>({})
  const [providersByClinic, setProvidersByClinic] = useState<Record<string, Provider[]>>({})
  const [patientCountByClinic, setPatientCountByClinic] = useState<Record<string, number>>({})
  // const [providerCountByClinic, setProviderCountByClinic] = useState<Record<string, number>>({})

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (userProfile?.role !== 'provider') {
      navigate('/dashboard', { replace: true })
    }
  }, [user, userProfile, authLoading, navigate])

  useEffect(() => {
    if (!user?.email || userProfile?.role !== 'provider') return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        let query = apiClient
          .from('providers')
          .select('*')
          .eq('email', user.email!)
        if (userProfile?.clinic_ids?.length) {
          query = query.overlaps('clinic_ids', userProfile.clinic_ids)
        }
        const { data: providerData, error: err } = await query.limit(1).maybeSingle()
        if (err) throw err
        if (!providerData) {
          setError('Your account is not linked to a provider.')
          setProvider(null)
          setClinics([])
          setPatientCountByClinic({})
          // setProviderCountByClinic({})
          setLoading(false)
          return
        }
        setProvider(providerData as Provider)
        const ids = (providerData as Provider).clinic_ids || []
        if (ids.length === 0) {
          setClinics([])
          setClinicStats({})
          setProvidersByClinic({})
          setPatientCountByClinic({})
          // setProviderCountByClinic({})
          setLoading(false)
          return
        }
        const { data: clinicsData, error: clinicsErr } = await apiClient
          .from('clinics')
          .select('*')
          .in('id', ids)
          .order('name')
        if (clinicsErr) throw clinicsErr
        setClinics(clinicsData || [])

        if (ids.length > 0) {
          const now = new Date()
          const y = now.getFullYear()
          const m = now.getMonth() + 1
          const currentMonthStart = `${y}-${String(m).padStart(2, '0')}-01`
          const nextMonth = m === 12 ? [y + 1, 1] : [y, m + 1]
          const nextMonthStart = `${nextMonth[0]}-${String(nextMonth[1]).padStart(2, '0')}-01`

          const [patientsRes, providersRes, todosRes, arRes] = await Promise.all([
            apiClient.from('patients').select('id, clinic_id').in('clinic_id', ids),
            apiClient.from('providers').select('*').overlaps('clinic_ids', ids),
            apiClient.from('todo_lists').select('id, clinic_id').in('clinic_id', ids),
            apiClient
              .from('accounts_receivables')
              .select('amount, clinic_id')
              .in('clinic_id', ids)
              .gte('date_recorded', currentMonthStart)
              .lt('date_recorded', nextMonthStart),
          ])

          const patientCount: Record<string, number> = {}
          ids.forEach((id) => { patientCount[id] = 0 })
          ;(patientsRes.data || []).forEach((p: { clinic_id: string }) => {
            patientCount[p.clinic_id] = (patientCount[p.clinic_id] || 0) + 1
          })
          setPatientCountByClinic(patientCount)

          const providerCount: Record<string, number> = {}
          const grouped: Record<string, Provider[]> = {}
          ids.forEach((id) => {
            providerCount[id] = 0
            grouped[id] = []
          })
          ;(providersRes.data || []).forEach((p: Provider) => {
            (p.clinic_ids || []).forEach((cid: string) => {
              if (providerCount[cid] != null) providerCount[cid] += 1
              if (grouped[cid]) grouped[cid].push(p)
            })
          })
          // setProviderCountByClinic(providerCount)
          setProvidersByClinic(grouped)

          const todoCount: Record<string, number> = {}
          ids.forEach((id) => { todoCount[id] = 0 })
          ;(todosRes.data || []).forEach((t: { clinic_id: string }) => {
            todoCount[t.clinic_id] = (todoCount[t.clinic_id] || 0) + 1
          })

          const currentMonthByClinic: Record<string, number> = {}
          ids.forEach((id) => { currentMonthByClinic[id] = 0 })
          ;(arRes.data || []).forEach((row: { amount: number | null; clinic_id: string }) => {
            const cid = row.clinic_id
            if (cid && currentMonthByClinic[cid] != null) {
              currentMonthByClinic[cid] += Number(row.amount ?? 0)
            }
          })

          const statsMap: Record<string, ClinicCardStats> = {}
          ids.forEach((id) => {
            statsMap[id] = {
              patientCount: patientCount[id] ?? 0,
              providerCount: providerCount[id] ?? 0,
              todoCount: todoCount[id] ?? 0,
              currentMonthTotal: currentMonthByClinic[id] ?? 0,
            }
          })
          setClinicStats(statsMap)
        }
      } catch (e) {
        console.error(e)
        setError('Failed to load your clinics.')
        setProvider(null)
        setClinics([])
        setClinicStats({})
        setProvidersByClinic({})
        setPatientCountByClinic({})
        // setProviderCountByClinic({})
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.email, userProfile?.role, userProfile?.clinic_ids])

  if (authLoading || (userProfile?.role === 'provider' && loading)) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400" />
      </div>
    )
  }

  if (userProfile?.role !== 'provider') return null
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-amber-900/30 border border-amber-600/50 text-amber-200 p-4">{error}</div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-8 flex items-center gap-3">
        <LayoutDashboard className="text-primary-400" size={32} />
        <div>
          <h1 className="text-3xl font-bold text-white">Provider Dashboard</h1>
          <p className="text-white/70">
            {provider ? `${provider.first_name} ${provider.last_name}` : ''}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Building2 className="text-primary-400" size={24} />
            <span className="text-3xl font-bold text-white">{clinics.length}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">My Clinics</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Users className="text-green-400" size={24} />
            <span className="text-3xl font-bold text-white">
              {Object.values(patientCountByClinic).reduce((a, b) => a + b, 0)}
            </span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Total Patients</h3>
        </div>

      </div>

      {/* Clinic cards – same layout as super admin dashboard */}
      {clinics.length > 0 && (
        <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
          <h2 className="text-xl font-semibold text-white mb-4 italic">My Clinics</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clinics.map((clinic) => {
              const s = clinicStats[clinic.id]
              const cardStats: ClinicCardStats | null = s
                ? {
                    patientCount: s.patientCount,
                    providerCount: s.providerCount,
                    todoCount: s.todoCount,
                    currentMonthTotal: s.currentMonthTotal,
                  }
                : null
              return (
                <ClinicCard
                  key={clinic.id}
                  clinic={clinic}
                  providers={providersByClinic[clinic.id] || []}
                  stats={cardStats}
                  customTo={`/providers/clinics/${clinic.id}/sheet`}
                  role={userProfile?.role}
                />
              )
            })}
          </div>
        </div>
      )}
      {clinics.length === 0 && !loading && (
        <p className="text-white/60">You are not assigned to any clinic yet.</p>
      )}
    </div>
  )
}
