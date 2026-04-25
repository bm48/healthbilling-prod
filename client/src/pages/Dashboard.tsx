import { useAuth } from '@/contexts/AuthContext'
import { FileText, Users, CheckSquare, Building2, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Clinic, Provider } from '@/types'
import ClinicCard, { ClinicCardStats } from '@/components/ClinicCard'

interface DashboardStats {
  totalClinics: number
  totalPatients: number
  totalUsers: number
  totalTodos: number
  totalProviderSheets: number
  totalTodosOpen: number
  totalTodosCompleted: number
}

interface ClinicStats {
  clinicId: string
  patientCount: number
  providerCount: number
  todoCount: number
  currentMonthTotal: number | null
}

export default function Dashboard() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [clinicStats, setClinicStats] = useState<Record<string, ClinicStats>>({})
  const [providersByClinic, setProvidersByClinic] = useState<Record<string, Provider[]>>({})
  const [stats, setStats] = useState<DashboardStats>({
    totalClinics: 0,
    totalPatients: 0,
    totalUsers: 0,
    totalTodos: 0,
    totalProviderSheets: 0,
    totalTodosOpen: 0,
    totalTodosCompleted: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userProfile) {
      if (userProfile.role === 'provider') {
        navigate('/providers', { replace: true })
        return
      }
      if (userProfile.role === 'official_staff' && userProfile.clinic_ids?.length === 1) {
        navigate(`/clinic/${userProfile.clinic_ids[0]}/todo`, { replace: true })
        return
      }
      if (userProfile.role === 'office_staff' && userProfile.clinic_ids?.length === 1) {
        navigate(`/clinic/${userProfile.clinic_ids[0]}`, { replace: true })
        return
      }
      if (userProfile.role === 'super_admin') {
        fetchSuperAdminDashboard()
      } else {
        setLoading(true)
        fetchClinics().finally(() => setLoading(false))
      }
    }
  }, [userProfile, navigate])

  const fetchSuperAdminDashboard = async () => {
    if (!userProfile) return

    try {
      setLoading(true)
      
      // Fetch all data in parallel
      const [clinicsData, patientsData, usersData, todosData, sheetsData] = await Promise.all([
        apiClient.from('clinics').select('id', { count: 'exact', head: true }),
        apiClient.from('patients').select('id', { count: 'exact', head: true }),
        apiClient.from('users').select('id', { count: 'exact', head: true }).eq('active', true),
        apiClient.from('todo_lists').select('id, completed_at', { count: 'exact' }),
        apiClient.from('provider_sheets').select('id', { count: 'exact', head: true }),
      ])

      // Fetch clinics list
      const { data: clinicsList, error: clinicsError } = await apiClient
        .from('clinics')
        .select('*')
        .order('name')

      if (clinicsError) throw clinicsError
      setClinics(clinicsList || [])
      
      if (clinicsList && clinicsList.length > 0) {
        const clinicIds = clinicsList.map(c => c.id)
        await Promise.all([
          fetchClinicStats(clinicIds),
          fetchProvidersForClinics(clinicIds),
        ])
      }

      // Calculate stats
      const todos = todosData.data || []
      const openTodos = todos.filter(t => !t.completed_at)
      const completedTodos = todos.filter(t => t.completed_at)

      setStats({
        totalClinics: clinicsData.count || 0,
        totalPatients: patientsData.count || 0,
        totalUsers: usersData.count || 0,
        totalTodos: todos.length,
        totalProviderSheets: sheetsData.count || 0,
        totalTodosOpen: openTodos.length,
        totalTodosCompleted: completedTodos.length,
      })
    } catch (error) {
      // Error fetching dashboard data
    } finally {
      setLoading(false)
    }
  }

  const fetchClinics = async () => {
    if (!userProfile) return

    try {
      let query = apiClient.from('clinics').select('*')
      
      // If not super admin, filter by clinic_ids
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('id', userProfile.clinic_ids)
      }

      const { data, error } = await query
      if (error) throw error
      setClinics(data || [])

      if (data && data.length > 0) {
        const clinicIds = data.map(c => c.id)
        await Promise.all([
          fetchClinicStats(clinicIds),
          fetchProvidersForClinics(clinicIds),
          fetchDashboardStatsForClinics(clinicIds),
        ])
      }
    } catch (error) {
      // Error fetching clinics
    }
  }

  const fetchDashboardStatsForClinics = async (clinicIds: string[]) => {
    if (!userProfile || clinicIds.length === 0) return
    try {
      const [patientsData, usersData, todosData, sheetsData] = await Promise.all([
        apiClient
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .in('clinic_id', clinicIds),
        apiClient
          .from('users')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .overlaps('clinic_ids', clinicIds),
        apiClient
          .from('todo_lists')
          .select('id, completed_at')
          .in('clinic_id', clinicIds),
        apiClient
          .from('provider_sheets')
          .select('id', { count: 'exact', head: true })
          .in('clinic_id', clinicIds),
      ])

      const todos = todosData.data || []
      const openTodos = todos.filter(t => !t.completed_at)
      const completedTodos = todos.filter(t => t.completed_at)

      setStats({
        totalClinics: clinicIds.length,
        totalPatients: patientsData.count || 0,
        totalUsers: usersData.count || 0,
        totalTodos: todos.length,
        totalProviderSheets: sheetsData.count || 0,
        totalTodosOpen: openTodos.length,
        totalTodosCompleted: completedTodos.length,
      })
    } catch (error) {
      console.error('Error fetching dashboard stats:', error)
    }
  }

  const fetchProvidersForClinics = async (clinicIds: string[]) => {
    try {
      const { data, error } = await apiClient
        .from('providers')
        .select('*')
        .eq('active', true)
        .overlaps('clinic_ids', clinicIds)
        .order('last_name')
        .order('first_name')

      if (error) throw error

      const grouped: Record<string, Provider[]> = {}
      data?.forEach((provider: Provider) => {
        (provider.clinic_ids || []).forEach((cid: string) => {
          if (!grouped[cid]) grouped[cid] = []
          grouped[cid].push(provider)
        })
      })
      setProvidersByClinic(grouped)
    } catch (error) {
      console.error('Error fetching providers for clinics:', error)
    }
  }

  const fetchClinicStats = async (clinicIds: string[]) => {
    try {
      const statsMap: Record<string, ClinicStats> = {}
      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth() + 1
      const currentMonthStart = `${y}-${String(m).padStart(2, '0')}-01`
      const nextMonth = m === 12 ? [y + 1, 1] : [y, m + 1]
      const nextMonthStart = `${nextMonth[0]}-${String(nextMonth[1]).padStart(2, '0')}-01`

      await Promise.all(
        clinicIds.map(async (clinicId) => {
          const [patientsResult, providersResult, todosResult, arResult] = await Promise.all([
            apiClient
              .from('patients')
              .select('id', { count: 'exact', head: true })
              .eq('clinic_id', clinicId),
            apiClient
              .from('providers')
              .select('id', { count: 'exact', head: true })
              .eq('active', true)
              .contains('clinic_ids', [clinicId]),
            apiClient
              .from('todo_lists')
              .select('id', { count: 'exact', head: true })
              .eq('clinic_id', clinicId),
            apiClient
              .from('accounts_receivables')
              .select('amount, date_recorded')
              .eq('clinic_id', clinicId)
              .gte('date_recorded', currentMonthStart)
              .lt('date_recorded', nextMonthStart),
          ])

          let currentMonthTotal: number | null = null
          if (arResult.data?.length) {
            const sum = arResult.data.reduce(
              (s: number, row: { amount: number | null }) => s + Number(row.amount ?? 0),
              0
            )
            currentMonthTotal = sum
          }

          statsMap[clinicId] = {
            clinicId,
            patientCount: patientsResult.count || 0,
            providerCount: providersResult.count || 0,
            todoCount: todosResult.count || 0,
            currentMonthTotal,
          }
        })
      )

      setClinicStats(statsMap)
    } catch (error) {
      console.error('Error fetching clinic stats:', error)
    }
  }


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  // Super Admin Dashboard
  if (userProfile?.role === 'super_admin') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Super Admin Dashboard</h1>
          <p className="text-white/70 mt-2">
            Welcome back, {userProfile?.full_name || userProfile?.email}
          </p>
        </div>

        {/* Summary Statistics */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Building2 className="text-primary-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalClinics}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total Clinics</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Users className="text-green-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalPatients}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total Patients</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Users className="text-blue-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalUsers}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total Users</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <CheckSquare className="text-yellow-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalTodos}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total To-Do Items</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <FileText className="text-purple-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalProviderSheets}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Provider Sheets</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <AlertCircle className="text-orange-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalTodosOpen}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Open To-Do Items</h3>
          </div>

          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <CheckSquare className="text-green-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalTodosCompleted}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Completed To-Do Items</h3>
          </div>
        </div>

        {/* Clinics List – card layout per design */}
        {clinics.length > 0 && (
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4 italic">All Clinics</h2>
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
                    role={userProfile?.role}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Billing Staff Dashboard – focused on billing tasks, timecards, and assigned clinics
  if (userProfile?.role === 'billing_staff') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Billing Staff Dashboard</h1>
          <p className="text-white/70 mt-2">
            Welcome back, {userProfile?.full_name || userProfile?.email}
          </p>
        </div>

        {/* Quick actions */}
        {/* <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <Link
            to="/todo"
            className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20 hover:border-primary-400/50 hover:scale-[1.02] transition-all flex items-center gap-4"
          >
            <CheckSquare className="text-yellow-400 shrink-0" size={32} />
            <div>
              <h3 className="text-lg font-semibold text-white">Billing To-Do</h3>
              <p className="text-white/70 text-sm">Manage and complete billing tasks</p>
              {stats.totalTodosOpen > 0 && (
                <p className="text-amber-300 text-sm mt-1">{stats.totalTodosOpen} open</p>
              )}
            </div>
          </Link>
          <Link
            to="/timecards"
            className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20 hover:border-primary-400/50 hover:scale-[1.02] transition-all flex items-center gap-4"
          >
            <Clock className="text-blue-400 shrink-0" size={32} />
            <div>
              <h3 className="text-lg font-semibold text-white">Timecards</h3>
              <p className="text-white/70 text-sm">Clock in / out and view hours</p>
            </div>
          </Link>
          <Link
            to="/patients"
            className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20 hover:border-primary-400/50 hover:scale-[1.02] transition-all flex items-center gap-4"
          >
            <Users className="text-green-400 shrink-0" size={32} />
            <div>
              <h3 className="text-lg font-semibold text-white">Patient Database</h3>
              <p className="text-white/70 text-sm">View and manage patient records</p>
            </div>
          </Link>
        </div> */}

        {/* Billing-focused stats */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Building2 className="text-primary-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalClinics}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Assigned Clinics</h3>
          </div>
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <Users className="text-green-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalPatients}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Total Patients</h3>
          </div>
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <AlertCircle className="text-orange-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalTodosOpen}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Open To-Do Items</h3>
          </div>
          <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
            <div className="flex items-center justify-between mb-2">
              <FileText className="text-purple-400" size={24} />
              <span className="text-3xl font-bold text-white">{stats.totalProviderSheets}</span>
            </div>
            <h3 className="text-sm font-medium text-white/70">Provider Sheets</h3>
          </div>
        </div>

        {clinics.length > 0 ? (
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4">Your Assigned Clinics</h2>
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
                    dashboardHref
                    role={userProfile?.role}
                  />
                )
              })}
            </div>
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
            <p className="text-white/70">No clinics assigned yet. Contact your admin to get access.</p>
          </div>
        )}
      </div>
    )
  }

  // Regular Dashboard for admin and office_staff – clinic card layout and summary cards
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">
          {userProfile?.role === 'admin'
            ? 'Admin Dashboard'
            : userProfile?.role === 'office_staff'
              ? 'Office Staff Dashboard'
              : 'Dashboard'}
        </h1>
        <p className="text-white/70 mt-2">
          Welcome back, {userProfile?.full_name || userProfile?.email}
        </p>
      </div>

      {/* Summary Statistics (scoped to user's clinics) */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Building2 className="text-primary-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats.totalClinics}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Total Clinics</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Users className="text-green-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats.totalPatients}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Total Patients</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <Users className="text-blue-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats.totalUsers}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Total Users</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <CheckSquare className="text-yellow-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats.totalTodos}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Total To-Do Items</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <FileText className="text-purple-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats.totalProviderSheets}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Provider Sheets</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <AlertCircle className="text-orange-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats.totalTodosOpen}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Open To-Do Items</h3>
        </div>

        <div className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl border border-white/20">
          <div className="flex items-center justify-between mb-2">
            <CheckSquare className="text-green-400" size={24} />
            <span className="text-3xl font-bold text-white">{stats.totalTodosCompleted}</span>
          </div>
          <h3 className="text-sm font-medium text-white/70">Completed To-Do Items</h3>
        </div>
      </div>

      {/* <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {getQuickActions().map((action) => {
          const Icon = action.icon
          return (
            <Link
              key={action.path}
              to={action.path}
              className="bg-white/10 backdrop-blur-md p-6 rounded-lg shadow-xl hover:shadow-2xl transition-all border border-white/20 hover:border-primary-400/50 hover:scale-105"
            >
              <Icon className="text-primary-400 mb-4" size={32} />
              <h3 className="text-lg font-semibold text-white">{action.label}</h3>
            </Link>
          )
        })}
      </div> */}

      {userProfile?.role === 'office_staff' && !loading && clinics.length === 0 && (
        <div className="bg-amber-500/20 backdrop-blur-md rounded-lg shadow-xl p-6 border border-amber-400/30">
          <p className="text-amber-200 font-medium">No clinic assigned.</p>
          <p className="text-white/80 text-sm mt-1">Contact your super admin or admin to get access to a clinic.</p>
        </div>
      )}

      {clinics.length > 0 && (
        <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
          <h2 className="text-xl font-semibold text-white mb-4 italic">Your Assigned Clinics</h2>
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
                  dashboardHref
                  role={userProfile?.role}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
