import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import 'aos/dist/aos.css'
import { 
  LayoutDashboard, 
  Users, 
  CheckSquare, 
  FileText, 
  BarChart3, 
  Clock, 
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Building2,
  DollarSign,
  Download,
  Database,
  Palette,
  Menu,
  ArrowLeft,
  Lock,
  KeyRound,
  X,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Clinic, Provider } from '@/types'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { user, userProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [expandedClinics, setExpandedClinics] = useState<Set<string>>(new Set())
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [loadingClinics, setLoadingClinics] = useState(false)
  const [clinicProviders, setClinicProviders] = useState<Record<string, Provider[]>>({})
  const [expandedSettings, setExpandedSettings] = useState(false)
  const [expandedClinicsSection, setExpandedClinicsSection] = useState(false)
  const [expandedProviderSheetSection, setExpandedProviderSheetSection] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // Provider sidebar: clinics the logged-in provider belongs to
  const [providerClinics, setProviderClinics] = useState<Clinic[]>([])
  const [loadingProviderClinics, setLoadingProviderClinics] = useState(false)
  const [providerClinicsSectionExpanded, setProviderClinicsSectionExpanded] = useState(false)
  const [providerClinicExpanded, setProviderClinicExpanded] = useState<Set<string>>(new Set())
  const prevPathnameRef = useRef(location.pathname)
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false)
  const [changePasswordCurrent, setChangePasswordCurrent] = useState('')
  const [changePasswordNew, setChangePasswordNew] = useState('')
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false)
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Error signing out:', error)
    } finally {
      navigate('/login')
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangePasswordError('')
    if (changePasswordNew.length < 6) {
      setChangePasswordError('New password must be at least 6 characters.')
      return
    }
    if (changePasswordNew !== changePasswordConfirm) {
      setChangePasswordError('New password and confirmation do not match.')
      return
    }
    if (!userProfile?.email) {
      setChangePasswordError('Could not determine your email.')
      return
    }
    setChangePasswordLoading(true)
    try {
      const { error: signInError } = await apiClient.auth.signInWithPassword({
        email: userProfile.email,
        password: changePasswordCurrent,
      })
      if (signInError) {
        setChangePasswordError('Current password is incorrect.')
        setChangePasswordLoading(false)
        return
      }
      const { error: updateError } = await apiClient.auth.updateUser({
        current_password: changePasswordCurrent,
        password: changePasswordNew,
      })
      if (updateError) {
        setChangePasswordError(updateError.message || 'Failed to update password.')
        setChangePasswordLoading(false)
        return
      }
      setChangePasswordCurrent('')
      setChangePasswordNew('')
      setChangePasswordConfirm('')
      setChangePasswordSuccess(true)
      setShowChangePasswordModal(false)
    } catch (err) {
      setChangePasswordError(err instanceof Error ? err.message : 'Failed to change password.')
    } finally {
      setChangePasswordLoading(false)
    }
  }

  // Fetch clinics for super admin, admin, billing_staff, official_staff, and office_staff
  useEffect(() => {
    if (userProfile?.role === 'super_admin' || userProfile?.role === 'admin' || userProfile?.role === 'billing_staff' || userProfile?.role === 'official_staff' || userProfile?.role === 'office_staff') {
      fetchClinics()
    }
  }, [userProfile])

  // Refetch clinics and providers when navigating back from settings so new/updated providers appear in sidebar immediately
  useEffect(() => {
    const fromSettings = prevPathnameRef.current.startsWith('/super-admin-settings') || prevPathnameRef.current.startsWith('/admin-settings')
    const toNonSettings = !location.pathname.startsWith('/super-admin-settings') && !location.pathname.startsWith('/admin-settings')
    if (fromSettings && toNonSettings && (userProfile?.role === 'super_admin' || userProfile?.role === 'admin' || userProfile?.role === 'billing_staff' || userProfile?.role === 'official_staff' || userProfile?.role === 'office_staff')) {
      fetchClinics()
    }
    prevPathnameRef.current = location.pathname
  }, [location.pathname, userProfile])

  // Fetch provider's clinics when role is provider
  useEffect(() => {
    if (userProfile?.role !== 'provider' || !user?.email) return
    const fetchProviderClinics = async () => {
      setLoadingProviderClinics(true)
      try {
        let query = apiClient.from('providers').select('*').eq('email', user.email!)
        if (userProfile?.clinic_ids?.length) {
          query = query.overlaps('clinic_ids', userProfile.clinic_ids)
        }
        const { data: providerData, error: err } = await query.limit(1).maybeSingle()
        if (err || !providerData) {
          setProviderClinics([])
          setLoadingProviderClinics(false)
          return
        }
        const ids = (providerData as Provider).clinic_ids || []
        if (ids.length === 0) {
          setProviderClinics([])
          setLoadingProviderClinics(false)
          return
        }
        const { data: clinicsData, error: clinicsErr } = await apiClient
          .from('clinics')
          .select('*')
          .in('id', ids)
          .order('name')
        if (clinicsErr) {
          setProviderClinics([])
          setLoadingProviderClinics(false)
          return
        }
        setProviderClinics(clinicsData || [])
      } catch {
        setProviderClinics([])
      } finally {
        setLoadingProviderClinics(false)
      }
    }
    fetchProviderClinics()
  }, [user?.email, userProfile?.role, userProfile?.clinic_ids])

  // Auto-expand clinic if on a clinic detail page (super admin, admin, billing_staff, official_staff, office_staff)
  useEffect(() => {
    if ((userProfile?.role === 'super_admin' || userProfile?.role === 'admin' || userProfile?.role === 'billing_staff' || userProfile?.role === 'official_staff' || userProfile?.role === 'office_staff') && location.pathname.startsWith('/clinic/')) {
      setExpandedClinicsSection(true)
      const clinicIdMatch = location.pathname.match(/^\/clinic\/([^/]+)/)
      if (clinicIdMatch && clinicIdMatch[1]) {
        const clinicId = clinicIdMatch[1]
        setExpandedClinics(prev => (prev.has(clinicId) ? prev : new Set([...prev, clinicId])))
      }
      if (location.pathname.match(/^\/clinic\/[^/]+\/providers\/[^/]+$/) && userProfile?.role === 'office_staff') {
        setExpandedProviderSheetSection(true)
      }
    }
  }, [location.pathname, userProfile])

  // Auto-expand provider clinics section and clinic when on /providers/clinics/:clinicId/...
  useEffect(() => {
    if (userProfile?.role === 'provider' && location.pathname.startsWith('/providers/clinics/')) {
      setProviderClinicsSectionExpanded(true)
      const match = location.pathname.match(/^\/providers\/clinics\/([^/]+)/)
      if (match && match[1]) {
        setProviderClinicExpanded(prev => (prev.has(match[1]) ? prev : new Set([...prev, match[1]])))
      }
    }
  }, [location.pathname, userProfile])

  const fetchClinics = async () => {
    if (!userProfile) return
    setLoadingClinics(true)
    try {
      let query = apiClient.from('clinics').select('*').order('name')
      if ((userProfile.role === 'admin' || userProfile.role === 'billing_staff' || userProfile.role === 'official_staff' || userProfile.role === 'office_staff') && userProfile.clinic_ids?.length) {
        query = query.in('id', userProfile.clinic_ids)
      }
      const { data, error } = await query
      if (error) throw error
      setClinics(data || [])
      // Fetch providers for all clinics immediately
      if (data && data.length > 0) {
        await fetchAllProviders(data.map(c => c.id))
      }
    } catch (error) {
      console.error('Error fetching clinics:', error)
    } finally {
      setLoadingClinics(false)
    }
  }

  const fetchAllProviders = async (clinicIds: string[]) => {
    try {
      const { data, error } = await apiClient
        .from('providers')
        .select('*')
        .eq('active', true)
        .overlaps('clinic_ids', clinicIds)
        .order('first_name')
        .order('last_name')
        .order('first_name')

      if (error) {
        console.error('Error fetching all providers:', error)
        throw error
      }

      const providersList = data || []
      // Group providers by clinic (a provider can appear in multiple clinics)
      const grouped: Record<string, Provider[]> = {}
      providersList.forEach(provider => {
        (provider.clinic_ids || []).forEach((cid: string) => {
          if (!grouped[cid]) grouped[cid] = []
          grouped[cid].push(provider)
        })
      })

      setClinicProviders(grouped)
    } catch (error) {
      console.error('Error fetching providers:', error)
    }
  }

  const fetchProvidersForClinic = async (clinicId: string) => {
    // Only fetch if not already loaded
    if (clinicProviders[clinicId]) {
      return
    }

    try {
      const { data, error } = await apiClient
        .from('providers')
        .select('*')
        .eq('active', true)
        .contains('clinic_ids', [clinicId])
        .order('last_name')
        .order('first_name')

      if (error) {
        console.error('Error fetching providers for clinic:', clinicId, error)
        throw error
      }

      setClinicProviders(prev => ({ ...prev, [clinicId]: data || [] }))
    } catch (error) {
      console.error('Error fetching providers:', error)
      setClinicProviders(prev => ({ ...prev, [clinicId]: [] }))
    }
  }

  // Fetch providers when clinic is expanded (fallback). Wait for fetchClinics + fetchAllProviders so we do not duplicate the same providers query as the sidebar bulk load.
  useEffect(() => {
    if (userProfile?.role === 'super_admin' || userProfile?.role === 'admin' || userProfile?.role === 'billing_staff' || userProfile?.role === 'official_staff') {
      if (loadingClinics) return
      expandedClinics.forEach(clinicId => {
        if (!clinicProviders[clinicId] || clinicProviders[clinicId].length === 0) {
          fetchProvidersForClinic(clinicId)
        }
      })
    }
  }, [expandedClinics, userProfile, loadingClinics, clinicProviders])

  const toggleClinic = (clinicId: string) => {
    setExpandedClinics(prev => {
      const newSet = new Set(prev)
      if (newSet.has(clinicId)) {
        newSet.delete(clinicId)
      } else {
        newSet.add(clinicId)
      }
      return newSet
    })
  }

  const isClinicExpanded = (clinicId: string) => expandedClinics.has(clinicId)

  const toggleSettings = () => {
    setExpandedSettings(prev => !prev)
  }

  const toggleClinicsSection = () => {
    setExpandedClinicsSection(prev => !prev)
  }

  // Auto-expand settings if on a settings page
  useEffect(() => {
    if ((userProfile?.role === 'super_admin' || userProfile?.role === 'admin') && (
      location.pathname.startsWith('/super-admin-settings') ||
      location.pathname.startsWith('/admin-settings') ||
      location.pathname.includes('/settings/')
    )) {
      setExpandedSettings(true)
    }
  }, [location.pathname, userProfile])

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['*'] },
    { name: 'Patient Database', href: '/patients', icon: Users, roles: ['office_staff', 'billing_staff', 'admin', 'super_admin'] },
    { name: 'Billing To-Do', href: '/todo', icon: CheckSquare, roles: ['billing_staff', 'admin', 'super_admin'] },
    { name: 'Timecards', href: '/timecards', icon: Clock, roles: ['office_staff', 'billing_staff', 'admin', 'super_admin'] },
    { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin', 'view_only_admin', 'super_admin'] },
  ]

  const toggleProviderClinic = (clinicId: string) => {
    setProviderClinicExpanded(prev => {
      const next = new Set(prev)
      if (next.has(clinicId)) next.delete(clinicId)
      else next.add(clinicId)
      return next
    })
  }

  const canAccess = (roles: string[]) => {
    if (!userProfile) return false
    if (roles.includes('*')) return true
    return roles.includes(userProfile.role) || userProfile.role === 'super_admin'
  }

  const filteredNavigation = navigation.filter(item => canAccess(item.roles))

  const isActive = (href: string) => location.pathname === href

  const isSuperAdmin = userProfile?.role === 'super_admin'
  const settingsPath = isSuperAdmin ? '/super-admin-settings' : '/admin-settings'
  const showBillingTodoInClinic = isSuperAdmin
  const isBillingStaff = userProfile?.role === 'billing_staff'
  const isOfficialStaff = userProfile?.role === 'official_staff'
  const isOfficeStaff = userProfile?.role === 'office_staff'

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-30 bg-slate-900/90 backdrop-blur-md shadow-2xl border-r border-white/10 transition-all duration-300 ${
        sidebarCollapsed ? 'w-20' : 'w-96'
      }`}>
        <div className="flex flex-col h-full">
          {/* Logo/Header */}
          <div className={`flex items-center mb-4 pt-10 gap-2 h-[110px] ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between'}`}>
            {!sidebarCollapsed && (
              <img
                src="/Matrix logo.png"
                alt="Logo"
                className="w-full max-h-320 object-contain"
              />
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-lg transition-colors shrink-0 -ml-12 mt-14"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <Menu size={20} /> : <ArrowLeft size={20} />}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 space-y-1 overflow-y-auto scrollbar-hide" style={{marginTop: '2rem'}}>
            {userProfile?.role === 'provider' ? (
              <>
                <Link
                  to="/providers"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    location.pathname === '/providers' || location.pathname === '/providers/'
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Dashboard"
                >
                  <LayoutDashboard size={20} />
                  {!sidebarCollapsed && <span>Dashboard</span>}
                </Link>
                {!sidebarCollapsed && (
                  <div className="mb-1">
                    <button
                      type="button"
                      onClick={() => setProviderClinicsSectionExpanded(!providerClinicsSectionExpanded)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                        location.pathname.startsWith('/providers/clinics/')
                          ? 'bg-primary-600/50 text-white font-medium'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {providerClinicsSectionExpanded ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <Building2 size={20} />
                      <span>Clinics</span>
                    </button>
                    {providerClinicsSectionExpanded && (
                      <div className="ml-2 mt-1 space-y-1">
                        {loadingProviderClinics ? (
                          <div className="px-4 py-2 text-xs text-white/50">Loading clinics...</div>
                        ) : (
                          providerClinics.map((clinic) => {
                            const isExpanded = providerClinicExpanded.has(clinic.id)
                            const isClinicActive = location.pathname.startsWith(`/providers/clinics/${clinic.id}`)
                            return (
                              <Link to={`/providers/clinics/${clinic.id}/sheet`} key={clinic.id} className="mb-1">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleProviderClinic(clinic.id)
                                    }}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-left flex-1 ${
                                      isClinicActive
                                        ? 'bg-primary-600/50 text-white font-medium'
                                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={16} />
                                    ) : (
                                      <ChevronRight size={16} />
                                    )}
                                    <Building2 size={16} />
                                    <span className="flex-1 truncate">{clinic.name}</span>
                                  </button>
                                </div>
{/* 
                                {isExpanded && (
                                  <div className="ml-6 mt-1 space-y-1">
                                    <Link
                                      to={`/providers/clinics/${clinic.id}/sheet`}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                        location.pathname === `/providers/clinics/${clinic.id}/sheet`
                                          ? 'bg-primary-600 text-white font-medium'
                                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                                      }`}
                                    >
                                      <FileText size={16} />
                                      <span>Sheet</span>
                                    </Link>
                                    <Link
                                      to={`/providers/clinics/${clinic.id}/schedule`}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                        location.pathname === `/providers/clinics/${clinic.id}/schedule`
                                          ? 'bg-primary-600 text-white font-medium'
                                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                                      }`}
                                    >
                                      <Calendar size={16} />
                                      <span>Schedule</span>
                                    </Link>
                                  </div>
                                )}
                                 */}
                              </Link>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* <Link
                  to="/messages"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mt-1 ${
                    isActive('/messages')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Messages"
                >
                  <MessageCircle size={20} />
                  {!sidebarCollapsed && <span>Messages</span>}
                </Link> */}

              </>
            ) : (userProfile?.role === 'super_admin' || userProfile?.role === 'admin') ? (
              <>
                {/* Dashboard for Super Admin / Admin */}
                <Link
                  to="/dashboard"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive('/dashboard')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Dashboard"
                >
                  <LayoutDashboard size={20} />
                  {!sidebarCollapsed && <span>Dashboard</span>}
                </Link>

                {/* Clinics as collapsible menu item (full: Patient Info, Billing To-Do, Providers) */}
                {!sidebarCollapsed && (
                <div className="mb-1">
                  <button
                    onClick={toggleClinicsSection}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                      location.pathname.startsWith('/clinic/')
                        ? 'bg-primary-600/50 text-white font-medium'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {expandedClinicsSection ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    <Building2 size={20} />
                    <span>Clinics</span>
                  </button>

                  {expandedClinicsSection && (
                    <div className="ml-6 mt-1 space-y-1">
                      {loadingClinics ? (
                        <div className="px-4 py-2 text-xs text-white/50">Loading clinics...</div>
                      ) : (
                        clinics.map((clinic) => {
                          const isExpanded = isClinicExpanded(clinic.id)
                          const clinicPath = `/clinic/${clinic.id}`
                          const isClinicActive = location.pathname.startsWith(clinicPath)
                          
                          return (
                            <div key={clinic.id} className="mb-1">
                              <div className="flex items-center gap-0">
                                <Link
                                  to={clinicPath}
                                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-left flex-1 min-w-0 ${
                                    location.pathname === clinicPath
                                      ? 'bg-primary-600 text-white font-medium'
                                      : isClinicActive
                                        ? 'bg-primary-600/50 text-white font-medium'
                                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <Building2 size={16} />
                                  <span className="flex-1 truncate">{clinic.name}</span>
                                </Link>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    toggleClinic(clinic.id)
                                  }}
                                  className={`p-2 rounded-lg transition-colors ${
                                    isClinicActive
                                      ? 'text-white hover:bg-white/10'
                                      : 'text-white/60 hover:bg-white/10 hover:text-white'
                                  }`}
                                  title={isExpanded ? 'Collapse' : 'Expand'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown size={16} />
                                  ) : (
                                    <ChevronRight size={16} />
                                  )}
                                </button>
                              </div>
                              
                              {isExpanded && (
                                <div className="ml-6 mt-1 space-y-1">
                                  <Link
                                    to={clinicPath}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                      location.pathname === clinicPath
                                        ? 'bg-primary-600 text-white font-medium'
                                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <LayoutDashboard size={16} />
                                    <span>Dashboard</span>
                                  </Link>
                                  <Link
                                    to={`${clinicPath}/patients`}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                      location.pathname === `${clinicPath}/patients`
                                        ? 'bg-primary-600 text-white font-medium'
                                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <Users size={16} />
                                    <span>Patient Info</span>
                                  </Link>
                                  {showBillingTodoInClinic && (
                                    <Link
                                      to={`${clinicPath}/todo`}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                        location.pathname === `${clinicPath}/todo`
                                          ? 'bg-primary-600 text-white font-medium'
                                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                                      }`}
                                    >
                                      <CheckSquare size={16} />
                                      <span>Billing To-Do</span>
                                    </Link>
                                  )}
                                  <div className="mb-2">
                                    <div className="px-4 py-1 text-xs font-semibold text-white/40 uppercase tracking-wider">
                                      Providers
                                    </div>
                                    {(() => {
                                      const providers = clinicProviders[clinic.id]
                                      if (providers && providers.length > 0) {
                                        return providers.map((provider) => (
                                          <Link
                                            key={provider.id}
                                            to={`${clinicPath}/providers/${provider.id}`}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ml-2 ${
                                              location.pathname === `${clinicPath}/providers/${provider.id}`
                                                ? 'bg-primary-600 text-white font-medium'
                                                : 'text-white/60 hover:bg-white/10 hover:text-white'
                                            }`}
                                          >
                                            <FileText size={14} />
                                            <span>{provider.first_name} {provider.last_name}</span>
                                            {/* {provider.specialty && (
                                              <span className="text-xs text-white/40">({provider.specialty})</span>
                                            )} */}
                                          </Link>
                                        ))
                                      } else {
                                        return (
                                          <div className="px-4 py-1 text-xs text-white/40 ml-2">
                                            {providers === undefined ? 'Loading...' : 'No providers'}
                                          </div>
                                        )
                                      }
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* Reports, TimeCards, Invoices, Settings for Super Admin */}
                <div className="mt-1">
                  <Link
                    to="/reports"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/reports')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title="Reports"
                  >
                    <BarChart3 size={20} />
                    {!sidebarCollapsed && <span>Reports</span>}
                  </Link>

                  <Link
                    to="/timecards"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/timecards')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title="TimeCards"
                  >
                    <Clock size={20} />
                    {!sidebarCollapsed && <span>TimeCards</span>}
                  </Link>

                  {
                    isSuperAdmin && (
                      <Link
                      to="/invoices"
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                        isActive('/invoices')
                          ? 'bg-primary-600 text-white font-medium shadow-lg'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      } ${sidebarCollapsed ? 'justify-center' : ''}`}
                      title="Invoices"
                    >
                      <DollarSign size={20} />
                      {!sidebarCollapsed && <span>Invoices</span>}
                    </Link>
                    )
                  }

                  {/* <Link
                    to="/messages"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/messages')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title="Messages"
                  >
                    <MessageCircle size={20} />
                    {!sidebarCollapsed && <span>Messages</span>}
                  </Link> */}

                  {/* Settings with submenu */}
                  {!sidebarCollapsed ? (
                  <div className="mb-1">
                    <button
                      onClick={toggleSettings}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                        location.pathname.startsWith(settingsPath) || location.pathname.includes('/settings/')
                          ? 'bg-primary-600/50 text-white font-medium'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {expandedSettings ? (
                        <ChevronDown size={16} />

                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <Settings size={20} />
                      <span>Settings</span>
                    </button>

                    {expandedSettings && (
                      <div className="ml-6 mt-1 space-y-1">
                        <Link
                          to={`${settingsPath}?tab=users`}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === settingsPath && location.search.includes('tab=users')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Users size={16} />
                          <span>User Management</span>
                        </Link>
                        <Link
                          to={`${settingsPath}?tab=billing-codes`}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === settingsPath && location.search.includes('tab=billing-codes')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Palette size={16} />
                          <span>Billing Codes</span>
                        </Link>
                        <Link
                          to={`${settingsPath}?tab=clinics`}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === settingsPath && location.search.includes('tab=clinics')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Building2 size={16} />
                          <span>Clinic Management</span>
                        </Link>
                        <Link
                          to={`${settingsPath}?tab=export`}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === settingsPath && location.search.includes('tab=export')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Download size={16} />
                          <span>Export Data</span>
                        </Link>
                        <Link
                          to={`${settingsPath}?tab=audit-logs`}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                            location.pathname === settingsPath && location.search.includes('tab=audit-logs')
                              ? 'bg-primary-600 text-white font-medium'
                              : 'text-white/60 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Database size={16} />
                          <span>Audit logs</span>
                        </Link>
                        {isSuperAdmin && (
                          <Link
                            to={`${settingsPath}?tab=unlock`}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                              location.pathname === settingsPath && location.search.includes('tab=unlock')
                                ? 'bg-primary-600 text-white font-medium'
                                : 'text-white/60 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <Database size={16} />
                            <span>Locked Sheets</span>
                          </Link>
                        )}
                        {isSuperAdmin && (
                          <Link
                            to={`${settingsPath}?tab=change-password`}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                              location.pathname === settingsPath && location.search.includes('tab=change-password')
                                ? 'bg-primary-600 text-white font-medium'
                                : 'text-white/60 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <KeyRound size={16} />
                            <span>Change Password</span>
                          </Link>
                        )}
                        {userProfile?.role === 'admin' && (
                          <Link
                            to={`${settingsPath}?tab=month-close`}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                              location.pathname === settingsPath && location.search.includes('tab=month-close')
                                ? 'bg-primary-600 text-white font-medium'
                                : 'text-white/60 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <Lock size={16} />
                            <span>Month Close</span>
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                  ) : (
                    <Link
                      to={settingsPath}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 justify-center ${
                        location.pathname.startsWith(settingsPath)
                          ? 'bg-primary-600 text-white font-medium shadow-lg'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                      title="Settings"
                    >
                      <Settings size={20} />
                    </Link>
                  )}
                </div>
              </>
            ) : isOfficialStaff ? (
              <>
                {/* Official Staff: Dashboard + single clinic Billing To-Do only */}
                <Link
                  to="/dashboard"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive('/dashboard')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Dashboard"
                >
                  <LayoutDashboard size={20} />
                  {!sidebarCollapsed && <span>Dashboard</span>}
                </Link>

                {!sidebarCollapsed && (
                  <div className="mb-1">
                    {loadingClinics ? (
                      <div className="px-4 py-2 text-xs text-white/50">Loading...</div>
                    ) : clinics.length === 0 ? (
                      <div className="px-4 py-2 text-xs text-white/50">No clinic assigned</div>
                    ) : (
                      <Link
                        to={`/clinic/${clinics[0].id}/todo`}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                          location.pathname.startsWith(`/clinic/${clinics[0].id}`)
                            ? 'bg-primary-600 text-white font-medium'
                            : 'text-white/70 hover:bg-white/10 hover:text-white'
                        }`}
                        title="Billing To-Do"
                      >
                        <CheckSquare size={20} />
                        <span className="flex-1 truncate">{clinics[0].name} – Billing</span>
                      </Link>
                    )}
                  </div>
                )}
                {/* <Link
                  to="/messages"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mt-1 ${
                    isActive('/messages')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Messages"
                >
                  <MessageCircle size={20} />
                  {!sidebarCollapsed && <span>Messages</span>}
                </Link> */}
              </>
            ) : isBillingStaff ? (
              <>
                {/* Dashboard for Billing Staff */}
                <Link
                  to="/dashboard"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive('/dashboard')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Dashboard"
                >
                  <LayoutDashboard size={20} />
                  {!sidebarCollapsed && <span>Dashboard</span>}
                </Link>

                {/* Clinics: Billing To-Do and Billing only (no Patient Info, no lock) */}
                {!sidebarCollapsed && (
                  <div className="mb-1">
                    <button
                      onClick={toggleClinicsSection}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                        location.pathname.startsWith('/clinic/')
                          ? 'bg-primary-600/50 text-white font-medium'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {expandedClinicsSection ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <Building2 size={20} />
                      <span>Clinics</span>
                    </button>

                    {expandedClinicsSection && (
                      <div className="ml-6 mt-1 space-y-1">
                        {loadingClinics ? (
                          <div className="px-4 py-2 text-xs text-white/50">Loading clinics...</div>
                        ) : (
                          clinics.map((clinic) => {
                            const isExpanded = isClinicExpanded(clinic.id)
                            const clinicPath = `/clinic/${clinic.id}`
                            const isClinicActive = location.pathname.startsWith(clinicPath)

                            return (
                              <div key={clinic.id} className="mb-1">
                                <div className="flex items-center gap-0">
                                  <Link
                                    to={clinicPath}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-left flex-1 min-w-0 ${
                                      location.pathname === clinicPath
                                        ? 'bg-primary-600 text-white font-medium'
                                        : isClinicActive
                                          ? 'bg-primary-600/50 text-white font-medium'
                                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <Building2 size={16} />
                                    <span className="flex-1 truncate">{clinic.name}</span>
                                  </Link>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      toggleClinic(clinic.id)
                                    }}
                                    className={`p-2 rounded-lg transition-colors ${
                                      isClinicActive
                                        ? 'text-white hover:bg-white/10'
                                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                                    title={isExpanded ? 'Collapse' : 'Expand'}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={16} />
                                    ) : (
                                      <ChevronRight size={16} />
                                    )}
                                  </button>
                                </div>

                                {isExpanded && (
                                  <div className="ml-6 mt-1 space-y-1">
                                    <Link
                                      to={clinicPath}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                        location.pathname === clinicPath
                                          ? 'bg-primary-600 text-white font-medium'
                                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                                      }`}
                                    >
                                      <LayoutDashboard size={16} />
                                      <span>Dashboard</span>
                                    </Link>
                                    <Link
                                      to={`${clinicPath}/patients`}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                        location.pathname === `${clinicPath}/patients`
                                          ? 'bg-primary-600 text-white font-medium'
                                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                                      }`}
                                    >
                                      <Users size={16} />
                                      <span>Patient Info</span>
                                    </Link>
                                    <Link
                                      to={`${clinicPath}/todo`}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                        location.pathname === `${clinicPath}/todo`
                                          ? 'bg-primary-600 text-white font-medium'
                                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                                      }`}
                                    >
                                      <CheckSquare size={16} />
                                      <span>Billing To-Do</span>
                                    </Link>
                                    <div className="mb-2">
                                      <div className="px-4 py-1 text-xs font-semibold text-white/40 uppercase tracking-wider">
                                        Billing
                                      </div>
                                      {(() => {
                                        const providers = clinicProviders[clinic.id]
                                        if (providers && providers.length > 0) {
                                          return providers.map((provider) => (
                                            <Link
                                              key={provider.id}
                                              to={`${clinicPath}/providers/${provider.id}`}
                                              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ml-2 ${
                                                location.pathname === `${clinicPath}/providers/${provider.id}`
                                                  ? 'bg-primary-600 text-white font-medium'
                                                  : 'text-white/60 hover:bg-white/10 hover:text-white'
                                              }`}
                                            >
                                              <FileText size={14} />
                                              <span>{provider.first_name} {provider.last_name}</span>
                                              {/* {provider.specialty && (
                                                <span className="text-xs text-white/40">({provider.specialty})</span>
                                              )} */}
                                            </Link>
                                          ))
                                        } else {
                                          return (
                                            <div className="px-4 py-1 text-xs text-white/40 ml-2">
                                              {providers === undefined ? 'Loading...' : 'No providers'}
                                            </div>
                                          )
                                        }
                                      })()}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Timecards only (no Patient Database, Billing To-Do, or Provider Sheet under clinics) */}
                <div className="mt-1">
                  <Link
                    to="/timecards"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/timecards')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title="Timecards"
                  >
                    <Clock size={20} />
                    {!sidebarCollapsed && <span>Timecards</span>}
                  </Link>
                  {/* <Link
                    to="/messages"
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                      isActive('/messages')
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title="Messages"
                  >
                    <MessageCircle size={20} />
                    {!sidebarCollapsed && <span>Messages</span>}
                  </Link> */}
                </div>
              </>
            ) : isOfficeStaff ? (
              <>
                {/* Office Staff: Dashboard, Patient Database, Provider Sheet (expandable) */}
                <Link
                  to="/dashboard"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive('/dashboard')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Dashboard"
                >
                  <LayoutDashboard size={20} />
                  {!sidebarCollapsed && <span>Dashboard</span>}
                </Link>

                {/* Timecards for office staff */}
                <Link
                  to="/timecards"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                    isActive('/timecards')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Timecards"
                >
                  <Clock size={20} />
                  {!sidebarCollapsed && <span>Timecards</span>}
                </Link>

                {/* <Link
                  to="/messages"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                    isActive('/messages')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Messages"
                >
                  <MessageCircle size={20} />
                  {!sidebarCollapsed && <span>Messages</span>}
                </Link> */}

                {/* <Link
                  to="/patients"
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors mb-1 ${
                    isActive('/patients')
                      ? 'bg-primary-600 text-white font-medium shadow-lg'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center' : ''}`}
                  title="Patient Database"
                >
                  <Users size={20} />
                  {!sidebarCollapsed && <span>Patient Database</span>}
                </Link> */}

                {/* Provider Sheet: expandable list of providers; click header = expand + go to first provider (office_staff only) */}
                {!sidebarCollapsed && (
                  <div className="mb-1">
                    
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedProviderSheetSection(prev => !prev)
                        if (!expandedProviderSheetSection) {
                          const firstClinic = clinics[0]
                          const firstProvider = firstClinic && clinicProviders[firstClinic.id]?.[0]
                          if (firstClinic && firstProvider) {
                            navigate(`/clinic/${firstClinic.id}/providers/${firstProvider.id}`)
                          }
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                        location.pathname.match(/^\/clinic\/[^/]+\/providers\/[^/]+$/)
                          ? 'bg-primary-600/50 text-white font-medium'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {expandedProviderSheetSection ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <FileText size={20} />
                      <span>
                        {userProfile?.role === 'office_staff' ? `${clinics[0]?.name}` : 'Provider Sheet'}
                      </span>
                    </button>
                    {expandedProviderSheetSection && (
                      <div className="ml-6 mt-1 space-y-1">
                        {loadingClinics ? (
                          <div className="px-4 py-2 text-xs text-white/50">Loading...</div>
                        ) : (
                          clinics.map((clinic) => {
                            const providers = clinicProviders[clinic.id]
                            const clinicPatientsPath = `/clinic/${clinic.id}/patients`
                            if (!providers || providers.length === 0) return null
                            return (
                              <div key={clinic.id} className="mb-2">
                              <Link
                                to={clinicPatientsPath}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                                  location.pathname === clinicPatientsPath
                                    ? 'bg-primary-600 text-white font-medium'
                                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <Users size={16} />
                                <span>Patient Info</span>
                              </Link>
                                <div className="px-4 py-1 text-xs font-semibold text-white/40 uppercase tracking-wider">
                                  {clinic.name}
                                </div>
                                {providers.map((provider) => (
                                  <Link
                                    key={provider.id}
                                    to={`/clinic/${clinic.id}/providers/${provider.id}`}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ml-2 block ${
                                      location.pathname === `/clinic/${clinic.id}/providers/${provider.id}`
                                        ? 'bg-primary-600 text-white font-medium'
                                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                                    }`}
                                  >
                                    <FileText size={14} />
                                    <span>{provider.first_name} {provider.last_name}</span>
                                    {/* {provider.specialty && (
                                      <span className="text-xs text-white/40">({provider.specialty})</span>
                                    )} */}
                                  </Link>
                                ))}
                              </div>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              filteredNavigation.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                      isActive(item.href)
                        ? 'bg-primary-600 text-white font-medium shadow-lg'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    } ${sidebarCollapsed ? 'justify-center' : ''}`}
                    title={item.name}
                  >
                    <Icon size={20} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                )
              })
            )}

          </nav>

          {/* User Info & Sign Out */}
          <div className="border-white/10 p-4">
            {!sidebarCollapsed && (
              // <div className='flex items-center gap-2'>
                <div className="mb-3 relative">
                  <div className="text-sm font-medium text-white truncate">
                    {userProfile?.full_name || userProfile?.email}
                  </div>
                  <div className="text-xs text-white/60 capitalize">
                    {userProfile?.role?.replace('_', ' ')}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowChangePasswordModal(true)
                      setChangePasswordCurrent('')
                      setChangePasswordNew('')
                      setChangePasswordConfirm('')
                      setChangePasswordError('')
                      setChangePasswordSuccess(false)
                    }}
                    className="absolute right-2 top-2 p-1 rounded text-white/70 hover:text-white hover:bg-white/10"
                    title="Change password"
                  >
                    <KeyRound size={24} />
                  </button>
                </div>
              // </div>
            )}
            <button
              onClick={handleSignOut}
              className={`w-full h-50 flex items-center gap-2 px-4 py-2 text-xl text-white/70 hover:bg-white/10 hover:text-white rounded-lg transition-colors ${
                sidebarCollapsed ? 'justify-center' : ''
              }`}
              title="Sign Out"
            >
              <LogOut size={32} />
              {!sidebarCollapsed && <span>Sign Out</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`min-h-screen transition-all duration-300 ${sidebarCollapsed ? 'ml-20' : 'ml-96'}`}>
        <main className="p-8 text-white min-h-full">
          {children}
        </main>
      </div>

      {/* Change Password Modal */}
      {showChangePasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Change password</h2>
              <button
                type="button"
                onClick={() => {
                  setShowChangePasswordModal(false)
                  setChangePasswordCurrent('')
                  setChangePasswordNew('')
                  setChangePasswordConfirm('')
                  setChangePasswordError('')
                  setChangePasswordSuccess(false)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="p-6 space-y-4">
              <div>
                <label htmlFor="layout-current-password" className="block text-sm font-medium text-gray-700 mb-1">
                  Current password
                </label>
                <input
                  id="layout-current-password"
                  type="password"
                  value={changePasswordCurrent}
                  onChange={(e) => setChangePasswordCurrent(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  placeholder="Enter current password"
                  required
                  autoComplete="current-password"
                  disabled={changePasswordLoading}
                />
              </div>
              <div>
                <label htmlFor="layout-new-password" className="block text-sm font-medium text-gray-700 mb-1">
                  New password
                </label>
                <input
                  id="layout-new-password"
                  type="password"
                  value={changePasswordNew}
                  onChange={(e) => setChangePasswordNew(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  disabled={changePasswordLoading}
                />
              </div>
              <div>
                <label htmlFor="layout-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm new password
                </label>
                <input
                  id="layout-confirm-password"
                  type="password"
                  value={changePasswordConfirm}
                  onChange={(e) => setChangePasswordConfirm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  placeholder="Confirm new password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  disabled={changePasswordLoading}
                />
              </div>
              {changePasswordError && (
                <p className="text-sm text-red-600">{changePasswordError}</p>
              )}
              {changePasswordSuccess && (
                <p className="text-sm text-green-600">Password updated successfully.</p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowChangePasswordModal(false)
                    setChangePasswordCurrent('')
                    setChangePasswordNew('')
                    setChangePasswordConfirm('')
                    setChangePasswordError('')
                    setChangePasswordSuccess(false)
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  disabled={changePasswordLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  disabled={changePasswordLoading}
                >
                  {changePasswordLoading ? 'Updating...' : 'Change password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
