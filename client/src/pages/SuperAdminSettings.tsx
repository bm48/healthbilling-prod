import { useState, useEffect } from 'react'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { apiClient, createApiClientWithStorageKey } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'
import { User, BillingCode, Clinic, ProviderSheet, AuditLog, Provider } from '@/types'
import { Users, Palette, FileText, Plus, Edit, Trash2, X, Unlock, Building2, Download, Link2, Check, Key, MapPin, Eye, EyeOff } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { fetchClinicAddressesByClinicIds } from '@/lib/clinicAddresses'
import MonthCloseTab from '@/components/MonthCloseTab'

/** Convert array of objects to CSV string (header row + data rows, values escaped). */
function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const escape = (val: unknown): string => {
    if (val == null) return ''
    let s: string
    if (Array.isArray(val)) s = val.join('; ')
    else if (typeof val === 'object') s = JSON.stringify(val)
    else s = String(val)
    if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const keys = Object.keys(rows[0])
  const header = keys.map(escape).join(',')
  const dataLines = rows.map(row => keys.map(k => escape(row[k])).join(','))
  return [header, ...dataLines].join('\r\n')
}

type SettingsTabId = 'users' | 'billing-codes' | 'audit-logs' | 'unlock' | 'clinics' | 'export' | 'month-close' | 'change-password'
type Variant = 'super_admin' | 'admin'

export default function SuperAdminSettings() {
  const { userProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') || 'users'
  const [activeTab, setActiveTab] = useState<SettingsTabId>((tabParam as SettingsTabId) || 'users')

  const isSuperAdminPath = location.pathname.startsWith('/super-admin-settings')
  const isAdminPath = location.pathname.startsWith('/admin-settings')
  const variant: Variant | null =
    isSuperAdminPath && userProfile?.role === 'super_admin'
      ? 'super_admin'
      : (isAdminPath && (userProfile?.role === 'admin' || userProfile?.role === 'super_admin'))
        ? 'admin'
        : null

  useEffect(() => {
    if (!userProfile) return
    if (isSuperAdminPath && userProfile.role !== 'super_admin') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (isAdminPath && userProfile.role !== 'admin' && userProfile.role !== 'super_admin') {
      navigate('/dashboard', { replace: true })
      return
    }
  }, [userProfile, isSuperAdminPath, isAdminPath, navigate])

  const pageTitle = variant === 'super_admin' ? 'Super Admin Settings' : 'Admin Settings'
  const [users, setUsers] = useState<User[]>([])
  const [billingCodes, setBillingCodes] = useState<BillingCode[]>([])
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [clinicAddressesByClinic, setClinicAddressesByClinic] = useState<Record<string, string[]>>({})
  const [providers, setProviders] = useState<Provider[]>([])
  const [providersByClinic, setProvidersByClinic] = useState<Record<string, Provider[]>>({})
  const [providerLevelsMap, setProviderLevelsMap] = useState<Record<string, number>>({})
  const [providerLevelsLoadError, setProviderLevelsLoadError] = useState(false)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [lockedSheets, setLockedSheets] = useState<ProviderSheet[]>([])
  const [loading, setLoading] = useState(true)
  const [showUserForm, setShowUserForm] = useState(false)
  const [showBillingCodeForm, setShowBillingCodeForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editingBillingCode, setEditingBillingCode] = useState<BillingCode | null>(null)
  const [showClinicForm, setShowClinicForm] = useState(false)
  const [editingClinic, setEditingClinic] = useState<Clinic | null>(null)
  const [assignClinicUser, setAssignClinicUser] = useState<User | null>(null)
  const [showAssignClinicModal, setShowAssignClinicModal] = useState(false)
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false)
  const [deleteUserPassword, setDeleteUserPassword] = useState('')
  const [deleteUserError, setDeleteUserError] = useState('')
  const [deleteUserLoading, setDeleteUserLoading] = useState(false)
  const [clinicToDelete, setClinicToDelete] = useState<Clinic | null>(null)
  const [showDeleteClinicModal, setShowDeleteClinicModal] = useState(false)
  const [deleteClinicPassword, setDeleteClinicPassword] = useState('')
  const [deleteClinicError, setDeleteClinicError] = useState('')
  const [deleteClinicLoading, setDeleteClinicLoading] = useState(false)
  const [userToToggleActive, setUserToToggleActive] = useState<User | null>(null)
  const [showToggleActiveModal, setShowToggleActiveModal] = useState(false)
  const [toggleActivePassword, setToggleActivePassword] = useState('')
  const [toggleActiveError, setToggleActiveError] = useState('')
  const [toggleActiveLoading, setToggleActiveLoading] = useState(false)
  const [changePasswordUserId, setChangePasswordUserId] = useState<string>('')
  const [changePasswordUserList, setChangePasswordUserList] = useState<User[]>([])
  const [changePasswordNew, setChangePasswordNew] = useState('')
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false)
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)
  const [showAddClinicAddressModal, setShowAddClinicAddressModal] = useState(false)

  useEffect(() => {
    const tab = (searchParams.get('tab') || 'users') as SettingsTabId
    const validForVariant: SettingsTabId[] =
      variant === 'super_admin'
        ? ['users', 'billing-codes', 'clinics', 'export', 'audit-logs', 'unlock', 'change-password']
        : variant === 'admin'
          ? ['users', 'billing-codes', 'clinics', 'export', 'audit-logs', 'month-close']
          : ['users', 'billing-codes', 'clinics', 'export', 'audit-logs']
    if (validForVariant.includes(tab) && tab !== activeTab) {
      setActiveTab(tab)
    } else if (variant === 'admin' && (tab === 'unlock' || tab === 'change-password')) {
      setActiveTab('users')
      setSearchParams({ tab: 'users' })
    } else if (variant === 'super_admin' && tab === 'month-close') {
      setActiveTab('users')
      setSearchParams({ tab: 'users' })
    }
  }, [searchParams, variant])

  useEffect(() => {
    if (variant) fetchData()
  }, [activeTab, variant])

  useEffect(() => {
    if (activeTab !== 'change-password' || variant !== 'super_admin') return
    const load = async () => {
      const { data, error } = await apiClient.from('users').select('*').order('email')
      if (!error && data) {
        setChangePasswordUserList((data as User[]) || [])
        setChangePasswordUserId((prev) => (prev ? prev : (data[0] as User)?.id ?? ''))
      }
    }
    load()
  }, [activeTab, variant])

  const fetchData = async () => {
    if (!variant) return
    if (activeTab === 'change-password') return
    setLoading(true)
    try {
      await Promise.all([
        fetchUsers(),
        fetchBillingCodes(),
        fetchClinics(),
      ])

      if (activeTab === 'audit-logs') {
        await fetchAuditLogs()
      } else if (activeTab === 'unlock' && variant === 'super_admin') {
        await fetchLockedSheets()
      } else if (activeTab === 'clinics') {
        await fetchClinics()
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const { data, error } = await apiClient.from('users').select('*').order('email').not('role', 'eq', 'super_admin')
      if (error) throw error
      let list = data || []
      if (variant === 'admin' && userProfile?.clinic_ids?.length) {
        list = list.filter((u: User) =>
          (u.clinic_ids || []).some((cid: string) => userProfile.clinic_ids.includes(cid))
        )
      }
      
      setUsers(list)
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchBillingCodes = async () => {
    try {
      const { data, error } = await apiClient.from('billing_codes').select('*').order('code')
      if (error) throw error
      setBillingCodes(data || [])
    } catch (error) {
      console.error('Error fetching billing codes:', error)
    }
  }

  const fetchClinics = async () => {
    try {
      let query = apiClient.from('clinics').select('*').order('name')
      if (variant === 'admin' && userProfile?.clinic_ids?.length) {
        query = query.in('id', userProfile.clinic_ids)
      }
      const { data, error } = await query
      if (error) throw error
      setClinics(data || [])

      const clinicIds = data?.length ? data.map((c: Clinic) => c.id) : []
      const addressesMap = await fetchClinicAddressesByClinicIds(clinicIds)
      setClinicAddressesByClinic(addressesMap)
      await fetchProvidersForClinics(clinicIds)
    } catch (error) {
      console.error('Error fetching clinics:', error)
    }
  }

  const fetchProvidersForClinics = async (clinicIds: string[]) => {
    try {
      let providerList: Provider[] = []
      if (variant === 'super_admin') {
        const { data, error } = await apiClient
          .from('providers')
          .select('*')
          .eq('active', true)
          .order('last_name')
          .order('first_name')
        if (!error) providerList = data || []
      } else {
        const { data, error } = await apiClient
          .from('providers')
          .select('*')
          .eq('active', true)
          .overlaps('clinic_ids', clinicIds)
          .order('last_name')
          .order('first_name')
        if (!error) providerList = data || []
      }

      // Group providers by clinic (a provider can appear in multiple clinics)
      const grouped: Record<string, Provider[]> = {}
      providerList.forEach(provider => {
        (provider.clinic_ids || []).forEach((cid: string) => {
          if (!grouped[cid]) grouped[cid] = []
          grouped[cid].push(provider)
        })
      })

      setProvidersByClinic(grouped)
      setProviders(providerList)

      // Provider level is on providers table (level column, 1 or 2)
      if (providerList.length > 0 && variant === 'super_admin') {
        const map: Record<string, number> = {}
        providerList.forEach((p: Provider) => {
          map[p.id] = p.level === 2 ? 2 : 1
        })
        setProviderLevelsMap(map)
        setProviderLevelsLoadError(false)
      } else {
        setProviderLevelsMap({})
        setProviderLevelsLoadError(false)
      }
    } catch (error) {
      console.error('Error fetching providers:', error)
    }
  }

  const fetchAuditLogs = async () => {
    try {
      const { data, error } = await apiClient
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setAuditLogs(data || [])
    } catch (error) {
      console.error('Error fetching audit logs:', error)
    }
  }

  const fetchLockedSheets = async () => {
    try {
      const { data, error } = await apiClient
        .from('provider_sheets')
        .select('*')
        .eq('locked', true)
        .order('updated_at', { ascending: false })

      if (error) throw error
      setLockedSheets(data || [])
    } catch (error) {
      console.error('Error fetching locked sheets:', error)
    }
  }

  const handleSaveUser = async (
    userData: Partial<User>,
    providerLevel?: number,
    providerCutPercent?: number,
    temporaryPassword?: string,
    showVisitTypeColumn?: boolean
  ) => {
    try {
      if (editingUser) {
        // users table does not have npi (it lives on providers); omit it from the users update
        const { npi: _npi, ...userDataForUsers } = userData as typeof userData & { npi?: string | null }
        const payload = { ...userDataForUsers }
        if (variant === 'super_admin' && userProfile?.id === editingUser.id && editingUser.role === 'super_admin') {
          payload.highlight_color = '#2d7e83'
        }
        const { error } = await apiClient
          .from('users')
          .update(payload)
          .eq('id', editingUser.id)

        if (error) throw error

        // For providers: keep providers table in sync (name, clinic_ids, level, provider_cut_percent) so Clinic Management shows correct names
        if (editingUser.role === 'provider' && editingUser.email) {
          const fullName = (userData.full_name ?? '').trim() || 'User'
          const spaceIdx = fullName.indexOf(' ')
          const first_name = spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName
          const last_name = spaceIdx > 0 ? fullName.slice(spaceIdx + 1).trim() || '-' : '-'

          const providersForEmail = providers.filter(p => p.email === editingUser.email)
          const npi = (userData as { npi?: string | null }).npi ?? null
          for (const p of providersForEmail) {
            const updatePayload: { first_name?: string; last_name?: string; npi?: string | null; clinic_ids?: string[]; level?: number; provider_cut_percent?: number; show_visit_type_column?: boolean; updated_at: string } = {
              first_name,
              last_name,
              npi,
              updated_at: new Date().toISOString(),
            }
            if (userData.clinic_ids != null && Array.isArray(userData.clinic_ids)) {
              updatePayload.clinic_ids = userData.clinic_ids
            }
            if (variant === 'super_admin') {
              if (providerLevel !== undefined && (providerLevel === 1 || providerLevel === 2)) {
                updatePayload.level = providerLevel
              }
              if (providerCutPercent !== undefined && providerCutPercent >= 0 && providerCutPercent <= 1) {
                updatePayload.provider_cut_percent = providerCutPercent
              }
              if (showVisitTypeColumn !== undefined) {
                updatePayload.show_visit_type_column = showVisitTypeColumn
              }
            }
            const { error: providerError } = await apiClient
              .from('providers')
              .update(updatePayload)
              .eq('id', p.id)
            if (providerError) throw providerError
          }
        }
        await fetchUsers()
        if (variant === 'super_admin') await fetchClinics()
        setShowUserForm(false)
        setEditingUser(null)
      } else {
        // Add User: create auth user with a separate client so current session stays intact
        const email = (userData.email || '').trim()
        if (!email) {
          alert('Email is required.')
          return
        }
        if (!temporaryPassword || temporaryPassword.length < 6) {
          alert('Please enter a temporary password (at least 6 characters).')
          return
        }
        const { data: existingUser } = await apiClient.from('users').select('id').eq('email', email).maybeSingle()
        if (existingUser) {
          alert('A user with this email already exists. Use a different email or edit the existing user.')
          return
        }
        const { data: authData, error: signUpError } = await apiClient.auth.adminCreateUser({
          email,
          password: temporaryPassword,
          full_name: userData.full_name || '',
          role: userData.role || 'billing_staff',
        })
        if (signUpError) {
          alert(signUpError.message || 'Failed to create user. Please try again.')
          return
        }
        const newUserId = authData.user?.id
        if (!newUserId) {
          alert('User was created but could not get user id. Please refresh the user list.')
          await fetchUsers()
          setShowUserForm(false)
          setEditingUser(null)
          return
        }
        // Upsert so public.users row always exists (trigger may not run or can be delayed); required for timecards FK
        const { error: upsertError } = await apiClient
          .from('users')
          .upsert(
            {
              id: newUserId,
              email,
              full_name: userData.full_name ?? null,
              role: userData.role ?? 'billing_staff',
              hourly_pay: userData.hourly_pay ?? null,
              highlight_color: userData.highlight_color ?? '#eab308',
              active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
        if (upsertError) {
          console.error('Error upserting new user profile:', upsertError)
          const isDuplicateEmail = upsertError.code === '23505' && (upsertError.message?.includes('users_email_key') || upsertError.message?.includes('email'))
          alert(
            isDuplicateEmail
              ? 'A user with this email already exists. The sign-in email was sent; ask the existing user to use the link or change their email in profile.'
              : 'User was created but profile update failed. You can edit the user to set details.'
          )
        } else {
          // Ensure provider row exists and has correct level/cut (trigger may create row with default level 1 before we run)
          if (userData.role === 'provider' && email) {
            const level = providerLevel === 1 || providerLevel === 2 ? providerLevel : 1
            const provider_cut_percent = providerCutPercent != null && providerCutPercent >= 0 && providerCutPercent <= 1 ? providerCutPercent : 0.7
            const { data: existing } = await apiClient.from('providers').select('id').eq('email', email).limit(1).maybeSingle()
            const npiNew = (userData as { npi?: string | null }).npi ?? null
            if (!existing) {
              const fullName = (userData.full_name ?? '').trim() || 'User'
              const spaceIdx = fullName.indexOf(' ')
              const first_name = spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName
              const last_name = spaceIdx > 0 ? fullName.slice(spaceIdx + 1).trim() || '-' : '-'
              await apiClient.from('providers').insert({
                email,
                first_name,
                last_name,
                npi: npiNew,
                clinic_ids: [],
                level,
                provider_cut_percent,
                active: true,
              })
            } else {
              // Trigger already created provider with default level 1; update to chosen level/cut, npi, and active
              await apiClient.from('providers').update({ level, provider_cut_percent, npi: npiNew, active: true }).eq('email', email)
            }
          }
          if (userData.hourly_pay != null && userData.hourly_pay > 0) {
            const now = new Date()
            const weekStart = new Date(now)
            const day = weekStart.getDay()
            const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
            weekStart.setDate(diff)
            weekStart.setHours(0, 0, 0, 0)
            const { error: tcError } = await apiClient.from('timecards').insert({
              user_id: newUserId,
              clock_in: now.toISOString(),
              clock_out: now.toISOString(),
              hours: 0,
              hourly_pay: userData.hourly_pay,
              week_start_date: weekStart.toISOString().split('T')[0],
            })
            if (tcError) {
              console.error('Error saving hourly pay to timecards:', tcError)
            }
          }
        }
        // Send invite email with sign-in link so the new user can open it and have email/password pre-filled
        const appOrigin = import.meta.env.VITE_APP_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')
        try {
          const inviteRes = await fetch('/api/send-invite-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, tempPassword: temporaryPassword, appOrigin }),
          })
          if (!inviteRes.ok) {
            const errData = await inviteRes.json().catch(() => ({}))
            console.error('Invite email failed:', errData)
            alert('User was created but the sign-in link email could not be sent. You can share the temporary password with the user manually.')
          }
        } catch (inviteErr) {
          console.error('Invite email error:', inviteErr)
          alert('User was created but the sign-in link email could not be sent. You can share the temporary password with the user manually.')
        }
        await fetchUsers()
        if (variant === 'super_admin') await fetchClinics()
        setShowUserForm(false)
        setEditingUser(null)
      }
    } catch (error) {
      console.error('Error saving user:', error)
      alert('Failed to save user. Please try again.')
    }
  }

  const handleSaveAssignClinics = async (user: User, clinicIds: string[]) => {
    try {
      const previousClinicIds = Array.isArray(user.clinic_ids) ? user.clinic_ids : []
      const newlyAssignedClinicIds = clinicIds.filter((cid) => !previousClinicIds.includes(cid))

      // Always update users table – this is the source of truth for clinic access for all roles (admin, billing_staff, office_staff, provider)
      const { error: userError } = await apiClient
        .from('users')
        .update({ clinic_ids: clinicIds })
        .eq('id', user.id)

      if (userError) throw userError

      // For providers, also update the providers table so provider sheet/schedule and sidebar use correct clinic_ids
      if (user.role === 'provider' && user.email) {
        let providerId: string | null = null
        const { data: existingProvider } = await apiClient.from('providers').select('id').eq('email', user.email).limit(1).maybeSingle()
        if (existingProvider) {
          providerId = existingProvider.id
          const { error: providerError } = await apiClient.from('providers').update({ clinic_ids: clinicIds }).eq('email', user.email)
          if (providerError) throw providerError
        } else {
          const fullName = (user.full_name ?? '').trim() || 'User'
          const spaceIdx = fullName.indexOf(' ')
          const first_name = spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName
          const last_name = spaceIdx > 0 ? fullName.slice(spaceIdx + 1).trim() || '-' : '-'
          const { data: insertedProvider, error: insertErr } = await apiClient
            .from('providers')
            .insert({
              email: user.email,
              first_name,
              last_name,
              clinic_ids: clinicIds,
            })
            .select('id')
            .maybeSingle()
          if (insertErr) throw insertErr
          providerId = insertedProvider?.id ?? null
        }

        // Ensure newly assigned clinics have a provider sheet for the current month.
        if (providerId && newlyAssignedClinicIds.length > 0) {
          const now = new Date()
          const month = now.getMonth() + 1
          const year = now.getFullYear()

          for (const clinicId of newlyAssignedClinicIds) {
            const clinicPayroll = (clinics.find((c) => c.id === clinicId)?.payroll ?? 1) as 1 | 2
            const { data: existingSheet, error: findSheetError } = await apiClient
              .from('provider_sheets')
              .select('id')
              .eq('clinic_id', clinicId)
              .eq('provider_id', providerId)
              .eq('month', month)
              .eq('year', year)
              .eq('payroll', clinicPayroll)
              .limit(1)
              .maybeSingle()

            if (findSheetError) {
              throw findSheetError
            }

            if (!existingSheet) {
              const { error: createSheetError } = await apiClient.from('provider_sheets').insert({
                clinic_id: clinicId,
                provider_id: providerId,
                month,
                year,
                payroll: clinicPayroll,
                locked: false,
                locked_columns: [],
              })
              if (createSheetError && createSheetError.code !== '23505') {
                throw createSheetError
              }
            }
          }
        }
      }

      await fetchUsers()
      setShowAssignClinicModal(false)
      setAssignClinicUser(null)
    } catch (error) {
      console.error('Error assigning clinics:', error)
      alert('Failed to assign clinics. Please try again.')
    }
  }

  const openToggleActiveModal = (user: User) => {
    if (variant !== 'super_admin') return
    setUserToToggleActive(user)
    setShowToggleActiveModal(true)
    setToggleActivePassword('')
    setToggleActiveError('')
  }

  const handleToggleShowVisitType = async (user: User) => {
    if (user.role !== 'provider' || !user.email) return
    const providersForEmail = providers.filter(p => p.email === user.email)
    if (providersForEmail.length === 0) return
    const current = providersForEmail[0].show_visit_type_column ?? false
    const next = !current
    try {
      const { error } = await apiClient
        .from('providers')
        .update({ show_visit_type_column: next, updated_at: new Date().toISOString() })
        .eq('email', user.email)
      if (error) throw error
      setProviders(prev =>
        prev.map(p => (p.email === user.email ? { ...p, show_visit_type_column: next } : p))
      )
    } catch (err) {
      console.error('Error toggling show visit type:', err)
      alert('Failed to update Visit Type column setting.')
    }
  }

  const handleConfirmToggleActive = async () => {
    if (!userToToggleActive || !userProfile?.email) return
    if (!toggleActivePassword.trim()) {
      setToggleActiveError('Please enter your password.')
      return
    }
    setToggleActiveError('')
    setToggleActiveLoading(true)
    try {
      const tempClient = createApiClientWithStorageKey('health-billing-auth-verify-password')
      const { error: signInError } = await tempClient.auth.signInWithPassword({
        email: userProfile.email,
        password: toggleActivePassword,
      })
      await tempClient.auth.signOut()
      if (signInError) {
        setToggleActiveError('Incorrect password.')
        setToggleActiveLoading(false)
        return
      }
      const nextActive = !(userToToggleActive.active !== false)
      const { error } = await apiClient
        .from('users')
        .update({ active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', userToToggleActive.id)
      if (error) throw error
      if (userToToggleActive.email) {
        await apiClient
          .from('providers')
          .update({ active: nextActive, updated_at: new Date().toISOString() })
          .eq('email', userToToggleActive.email)
      }
      setShowToggleActiveModal(false)
      setUserToToggleActive(null)
      setToggleActivePassword('')
      await fetchUsers()
      if (variant === 'super_admin') await fetchClinics()
    } catch (error) {
      console.error('Error toggling user active:', error)
      setToggleActiveError('Failed to update user active status. Please try again.')
    } finally {
      setToggleActiveLoading(false)
    }
  }

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete || !userProfile?.email) return
    if (userToDelete.id === userProfile.id) {
      setDeleteUserError('You cannot delete your own account.')
      return
    }
    if (!deleteUserPassword.trim()) {
      setDeleteUserError('Please enter your password.')
      return
    }
    setDeleteUserError('')
    setDeleteUserLoading(true)
    try {
      const tempClient = createApiClientWithStorageKey('health-billing-auth-verify-password')
      const { error: signInError } = await tempClient.auth.signInWithPassword({
        email: userProfile.email,
        password: deleteUserPassword,
      })
      await tempClient.auth.signOut()
      if (signInError) {
        setDeleteUserError('Incorrect password.')
        setDeleteUserLoading(false)
        return
      }
      const { error: deleteError } = await apiClient
        .from('users')
        .delete()
        .eq('id', userToDelete.id)
      if (deleteError) {
        setDeleteUserError(deleteError.message || 'Failed to delete user. Please try again.')
        setDeleteUserLoading(false)
        return
      }
      setShowDeleteUserModal(false)
      setUserToDelete(null)
      setDeleteUserPassword('')
      await fetchUsers()
      if (variant === 'super_admin') await fetchClinics()
    } catch (error) {
      console.error('Error deleting user:', error)
      setDeleteUserError('Failed to delete user. Please try again.')
    } finally {
      setDeleteUserLoading(false)
    }
  }

  const handleSaveBillingCode = async (codeData: Partial<BillingCode>) => {
    try {
      if (editingBillingCode) {
        const { error } = await apiClient
          .from('billing_codes')
          .update(codeData)
          .eq('id', editingBillingCode.id)

        if (error) throw error
      } else {
        const { error } = await apiClient
          .from('billing_codes')
          .insert(codeData)

        if (error) throw error
      }
      await fetchBillingCodes()
      setShowBillingCodeForm(false)
      setEditingBillingCode(null)
    } catch (error) {
      console.error('Error saving billing code:', error)
      alert('Failed to save billing code. Please try again.')
    }
  }

  const handleSaveClinic = async (clinicData: Partial<Clinic>) => {
    try {
      if (editingClinic) {
        const { error } = await apiClient
          .from('clinics')
          .update({
            name: clinicData.name ?? editingClinic.name,
            phone: clinicData.phone ?? editingClinic.phone,
            fax: clinicData.fax ?? editingClinic.fax ?? null,
            npi: clinicData.npi ?? editingClinic.npi ?? null,
            ein: clinicData.ein ?? editingClinic.ein ?? null,
            payroll: clinicData.payroll ?? editingClinic.payroll ?? 1,
            invoice_rate: clinicData.invoice_rate !== undefined ? clinicData.invoice_rate : editingClinic.invoice_rate ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingClinic.id)

        if (error) throw error
      } else {
        const { error } = await apiClient
          .from('clinics')
          .insert({
            name: clinicData.name ?? '',
            phone: clinicData.phone ?? null,
            fax: clinicData.fax ?? null,
            npi: clinicData.npi ?? null,
            ein: clinicData.ein ?? null,
            payroll: clinicData.payroll ?? 1,
            invoice_rate: clinicData.invoice_rate ?? null,
          })

        if (error) throw error
      }
      setShowClinicForm(false)
      setEditingClinic(null)
      await fetchClinics()
    } catch (error) {
      console.error('Error saving clinic:', error)
      alert('Failed to save clinic. Please try again.')
    }
  }

  const handleConfirmDeleteClinic = async () => {
    if (!clinicToDelete || !userProfile?.email) return
    if (!deleteClinicPassword.trim()) {
      setDeleteClinicError('Please enter your password.')
      return
    }
    setDeleteClinicError('')
    setDeleteClinicLoading(true)
    try {
      const tempClient = createApiClientWithStorageKey('health-billing-auth-verify-password')
      const { error: signInError } = await tempClient.auth.signInWithPassword({
        email: userProfile.email,
        password: deleteClinicPassword,
      })
      await tempClient.auth.signOut()
      if (signInError) {
        setDeleteClinicError('Incorrect password.')
        setDeleteClinicLoading(false)
        return
      }
      const { error: deleteError } = await apiClient.from('clinics').delete().eq('id', clinicToDelete.id)
      if (deleteError) {
        setDeleteClinicError(deleteError.message || 'Failed to delete clinic. Please try again.')
        setDeleteClinicLoading(false)
        return
      }
      setShowDeleteClinicModal(false)
      setClinicToDelete(null)
      setDeleteClinicPassword('')
      await fetchClinics()
    } catch (error) {
      console.error('Error deleting clinic:', error)
      setDeleteClinicError('Failed to delete clinic. Please try again.')
    } finally {
      setDeleteClinicLoading(false)
    }
  }

  const handleDeleteBillingCode = async (id: string) => {
    if (!confirm('Are you sure you want to delete this billing code?')) return

    try {
      const { error } = await apiClient
        .from('billing_codes')
        .delete()
        .eq('id', id)

      if (error) throw error
      await fetchBillingCodes()
    } catch (error) {
      console.error('Error deleting billing code:', error)
      alert('Failed to delete billing code. Please try again.')
    }
  }

  const handleUnlockSheet = async (sheetId: string) => {
    if (!confirm('Are you sure you want to unlock this sheet?')) return

    try {
      const { error } = await apiClient
        .from('provider_sheets')
        .update({
          locked: false,
          locked_columns: [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', sheetId)

      if (error) throw error
      await fetchLockedSheets()
    } catch (error) {
      console.error('Error unlocking sheet:', error)
      alert('Failed to unlock sheet. Please try again.')
    }
  }

  const baseTabs = [
    { id: 'users' as const, label: 'User Management', icon: Users },
    { id: 'billing-codes' as const, label: 'Billing Codes', icon: Palette },
    { id: 'clinics' as const, label: 'Clinic Management', icon: Building2 },
    { id: 'export' as const, label: 'Export Data', icon: Download },
    { id: 'audit-logs' as const, label: 'Audit Logs', icon: FileText },
  ]
  const tabs =
    variant === 'super_admin'
      ? [...baseTabs, { id: 'unlock' as const, label: 'Locked Sheets', icon: Unlock }, { id: 'change-password' as const, label: 'Change Password', icon: Key }]
      // : variant === 'admin'
      //   ? [...baseTabs, { id: 'month-close' as const, label: 'Month Close', icon: Calendar }]
        : baseTabs

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as SettingsTabId)
    setSearchParams({ tab: tabId })
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangePasswordError('')
    setChangePasswordSuccess(false)
    if (!changePasswordUserId) {
      setChangePasswordError('Please select a user.')
      return
    }
    if (!changePasswordNew || changePasswordNew.length < 6) {
      setChangePasswordError('New password must be at least 6 characters.')
      return
    }
    if (changePasswordNew !== changePasswordConfirm) {
      setChangePasswordError('New password and confirmation do not match.')
      return
    }
    const { data: sessionData } = await apiClient.auth.getSession()
    if (!sessionData?.session?.access_token) {
      setChangePasswordError('You must be signed in to change a password.')
      return
    }
    setChangePasswordLoading(true)
    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
      const adminUpdatePasswordUrl = apiBase ? `${apiBase}/api/auth/admin-update-password` : '/api/auth/admin-update-password'
      const res = await fetch(adminUpdatePasswordUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ userId: changePasswordUserId, newPassword: changePasswordNew }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setChangePasswordError(data.error || 'Failed to update password.')
        setChangePasswordLoading(false)
        return
      }
      setChangePasswordNew('')
      setChangePasswordConfirm('')
      setChangePasswordSuccess(true)
    } catch (err) {
      setChangePasswordError(err instanceof Error ? err.message : 'Failed to change password.')
    } finally {
      setChangePasswordLoading(false)
    }
  }

  if (variant === null) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-6">{pageTitle}</h1>

      <div className="bg-white/10 rounded-lg shadow-md">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-1 p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'text-white/90 hover:bg-white/10'
                  }`}
                >
                  <Icon size={18} />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-gray-700">Loading...</div>
          ) : (
            <>
              {activeTab === 'users' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">User Management</h2>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => {
                          setEditingUser(null)
                          setShowUserForm(true)
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                      >
                        <Plus size={18} />
                        Add User
                      </button>
                    </div>
                  </div>

                  <div className="table-container dark-theme">
                    <table className="table-spreadsheet dark-theme">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          {variant === 'super_admin' && <th>Active</th>}
                          {variant === 'super_admin' && <th>Provider Level</th>}
                          {variant === 'super_admin' && <th>Visit Type</th>}
                          {variant === 'super_admin' && <th>Highlight Color</th>}
                          <th>Clinics</th>
                          <th>Assign Clinics</th>
                          <th style={{ width: '80px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.sort((a, b) => a.full_name?.localeCompare(b.full_name ?? '') ?? 0).map((user) => {
                          const providersForUser = user.role === 'provider' ? providers.filter(p => p.email === user.email) : []
                          const levelInMap = providersForUser.length > 0 ? providerLevelsMap[providersForUser[0].id] : undefined
                          const displayLevel = providersForUser.length > 0
                            ? (levelInMap ?? (providerLevelsLoadError ? null : 1))
                            : null
                          const providerCutPercent = providersForUser.length > 0 ? (providersForUser[0].provider_cut_percent ?? 0.7) : 0.7
                          const levelAndPercent = displayLevel != null
                            ? `${displayLevel === 1 ? 'Partial' : 'Full'}, ${Math.round(providerCutPercent * 100)}%`
                            : null
                          return (
                            <tr key={user.id}>
                              <td>{user.full_name || '-'}</td>
                              <td>{user.email}</td>
                              <td>
                                <span className="status-badge" style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>
                                  {user.role}
                                </span>
                              </td>
                              {variant === 'super_admin' && (
                                <td>
                                  <div className="flex flex-col items-center gap-1">
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={user.active !== false}
                                      onClick={() => openToggleActiveModal(user)}
                                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 ${user.active !== false ? 'bg-blue-500 focus:ring-blue-400' : 'bg-gray-300 focus:ring-gray-400'}`}
                                      title={user.active !== false ? 'Active (click to deactivate)' : 'Inactive (click to activate)'}
                                    >
                                      <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform mt-0.5 ${user.active !== false ? 'translate-x-6' : 'translate-x-1'}`}
                                      />
                                    </button>
                                    <span className={`text-xs ${user.active !== false ? 'text-white/80' : 'text-slate-400'}`}>
                                      {user.active !== false ? 'Active' : 'Inactive'}
                                    </span>
                                  </div>
                                </td>
                              )}
                              {variant === 'super_admin' && (
                                <td>
                                  {user.role === 'provider' ? (levelAndPercent != null ? levelAndPercent : <span title={providerLevelsLoadError ? 'Level could not be loaded' : undefined}>—</span>) : <span className="text-white/50">—</span>}
                                </td>
                              )}
                              {variant === 'super_admin' && (
                                <td>
                                  {user.role === 'provider' && providersForUser.length > 0 ? (
                                    <div className="flex flex-col items-center gap-1">
                                      <button
                                        type="button"
                                        role="switch"
                                        aria-checked={providersForUser[0].show_visit_type_column ?? false}
                                        onClick={() => handleToggleShowVisitType(user)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 ${(providersForUser[0].show_visit_type_column ?? false) ? 'bg-blue-500 focus:ring-blue-400' : 'bg-gray-300 focus:ring-gray-400'}`}
                                        title={(providersForUser[0].show_visit_type_column ?? false) ? 'Visit Type column on (click to turn off)' : 'Visit Type column off (click to turn on)'}
                                      >
                                        <span
                                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform mt-0.5 ${(providersForUser[0].show_visit_type_column ?? false) ? 'translate-x-6' : 'translate-x-1'}`}
                                        />
                                      </button>
                                      <span className={`text-xs ${(providersForUser[0].show_visit_type_column ?? false) ? 'text-white/80' : 'text-slate-400'}`}>
                                        {(providersForUser[0].show_visit_type_column ?? false) ? 'On' : 'Off'}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-white/50">—</span>
                                  )}
                                </td>
                              )}
                              {variant === 'super_admin' && (
                                <td>
                                  {(() => {
                                    const color = user.role === 'super_admin' ? '#2d7e83' : (user.highlight_color || '#eab308')
                                    return (
                                      <div
                                        className="inline-block w-8 h-6 rounded border border-white/30 shrink-0"
                                        style={{ backgroundColor: color }}
                                        title={color}
                                      />
                                    )
                                  })()}
                                </td>
                              )}
                              <td>
                                {user.clinic_ids.length > 0
                                  ? user.clinic_ids.length + ' clinic(s)'
                                  : 'None'}
                              </td>
                              <td>
                                {(user.role === 'provider' || user.role === 'admin' || user.role === 'billing_staff' || user.role === 'office_staff') ? (
                                  <button
                                    onClick={() => {
                                      setAssignClinicUser(user)
                                      setShowAssignClinicModal(true)
                                    }}
                                    className="text-primary-400 hover:text-primary-300 inline-flex items-center gap-1"
                                    style={{ padding: '4px' }}
                                    title="Assign clinics"
                                  >
                                    <Link2 size={16} />
                                  </button>
                                ) : (
                                  <span className="text-white/50">—</span>
                                )}
                              </td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setEditingUser(user)
                                      setShowUserForm(true)
                                    }}
                                    className="text-primary-400 hover:text-primary-300"
                                    style={{ padding: '4px' }}
                                    title="Edit"
                                  >
                                    <Edit size={16} />
                                  </button>
                                  {variant === 'super_admin' && user.id !== userProfile?.id && (
                                    <button
                                      onClick={() => {
                                        setUserToDelete(user)
                                        setShowDeleteUserModal(true)
                                        setDeleteUserPassword('')
                                        setDeleteUserError('')
                                      }}
                                      className="text-red-400 hover:text-red-300"
                                      style={{ padding: '4px' }}
                                      title="Delete user"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'billing-codes' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Billing Codes</h2>
                    <button
                      onClick={() => {
                        setEditingBillingCode(null)
                        setShowBillingCodeForm(true)
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                    >
                      <Plus size={18} />
                      Add Code
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {billingCodes.map((code) => (
                      <div
                        key={code.id}
                        className="border border-gray-200 rounded-lg p-4"
                        style={{ borderLeftColor: code.color, borderLeftWidth: '4px' }}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="font-semibold text-white">{code.code}</h3>
                            {code.description && (
                              <p className="text-sm text-white/90">{code.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingBillingCode(code)
                                setShowBillingCodeForm(true)
                              }}
                              className="text-primary-600 hover:text-primary-700"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteBillingCode(code.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <div
                          className="w-full h-4 rounded"
                          style={{ backgroundColor: code.color }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'audit-logs' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Audit Logs</h2>
                  <div className="table-container dark-theme">
                    <table className="table-spreadsheet dark-theme">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>User</th>
                          <th>Action</th>
                          <th>Table</th>
                          <th>Record ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{formatDateTime(log.created_at)}</td>
                            <td>
                              {users.find(u => u.id === log.user_id)?.email || log.user_id}
                            </td>
                            <td>
                              <span className="status-badge" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#ffffff' }}>
                                {log.action}
                              </span>
                            </td>
                            <td>{log.table_name}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{log.record_id.substring(0, 8)}...</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'clinics' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Clinic Management</h2>
                    <div className="flex items-center gap-2">
                      {variant === 'super_admin' && (
                        <button
                          onClick={() => setShowAddClinicAddressModal(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                        >
                          <MapPin size={18} />
                          Add Clinic Address
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingClinic(null)
                          setShowClinicForm(true)
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                      >
                        <Plus size={18} />
                        Add Clinic
                      </button>
                    </div>
                  </div>

                  <div className="table-container dark-theme">
                    <table className="table-spreadsheet dark-theme">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Address</th>
                          <th>Phone</th>
                          <th>Providers</th>
                          <th>Payroll</th>
                          <th>Invoice rate</th>
                          <th>Created</th>
                          <th style={{ width: '80px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clinics.map((clinic) => {
                          const clinicProviders = providersByClinic[clinic.id] || []
                          return (
                            <tr key={clinic.id}>
                              <td>{clinic.name}</td>
                              <td>{(clinicAddressesByClinic[clinic.id]?.[0]?.trim()) || '-'}</td>
                              <td>{clinic.phone || '-'}</td>
                              <td>
                                {clinicProviders.length > 0 ? (
                                  <div className="space-y-1">
                                    {clinicProviders.map((provider) => (
                                      <div key={provider.id} className="text-sm">
                                        {provider.first_name} {provider.last_name}
                                        {provider.specialty && (
                                          <span className="text-white/60 ml-2">({provider.specialty})</span>
                                        )}
                                        {!provider.active && (
                                          <span className="text-red-400 ml-2 text-xs">(Inactive)</span>
                                        )}
                                      </div>
                                      
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-white/50">No providers</span>
                                )}
                              </td>
                              <td>{clinic.payroll === 1 ? 'Once' : 'Twice'}</td>
                              <td>{clinic.invoice_rate != null ? `${(clinic.invoice_rate * 100).toFixed(2)}%` : '—'}</td>
                              <td>{formatDateTime(clinic.created_at)}</td>
                              <td>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => {
                                      setEditingClinic(clinic)
                                      setShowClinicForm(true)
                                    }}
                                    className="text-primary-400 hover:text-primary-300"
                                    style={{ padding: '4px' }}
                                    title="Edit"
                                  >
                                    <Edit size={16} />
                                  </button>
                                  {variant === 'super_admin' && (
                                    <button
                                      onClick={() => {
                                        setClinicToDelete(clinic)
                                        setShowDeleteClinicModal(true)
                                        setDeleteClinicPassword('')
                                        setDeleteClinicError('')
                                      }}
                                      className="text-red-400 hover:text-red-300"
                                      style={{ padding: '4px' }}
                                      title="Delete clinic"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'export' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Export Data</h2>
                  <div className="space-y-4">
                    <div className="bg-white/5 rounded-lg p-6 border border-white/20">
                      <h3 className="text-lg font-semibold text-white mb-4">Export Options</h3>
                      <div className="space-y-3">
                        <button
                          onClick={async () => {
                            try {
                              const { data: users } = await apiClient.from('users').select('*')
                              const csv = toCSV((users ?? []) as Record<string, unknown>[])
                              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `users-${new Date().toISOString().split('T')[0]}.csv`
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch (error) {
                              console.error('Error exporting users:', error)
                              alert('Failed to export users')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Users
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const { data: clinics } = await apiClient.from('clinics').select('*')
                              const csv = toCSV((clinics ?? []) as Record<string, unknown>[])
                              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `clinics-${new Date().toISOString().split('T')[0]}.csv`
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch (error) {
                              console.error('Error exporting clinics:', error)
                              alert('Failed to export clinics')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Clinics
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const { data: patients } = await apiClient.from('patients').select('*')
                              const csv = toCSV((patients ?? []) as Record<string, unknown>[])
                              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `patients-${new Date().toISOString().split('T')[0]}.csv`
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch (error) {
                              console.error('Error exporting patients:', error)
                              alert('Failed to export patients')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Patients
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const { data: auditLogs } = await apiClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(1000)
                              const csv = toCSV((auditLogs ?? []) as Record<string, unknown>[])
                              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch (error) {
                              console.error('Error exporting audit logs:', error)
                              alert('Failed to export audit logs')
                            }
                          }}
                          className="w-full flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                          <Download size={18} />
                          Export Audit Logs
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'change-password' && variant === 'super_admin' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Change Password</h2>
                  <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
                    <div>
                      <label htmlFor="change-password-user" className="block text-sm font-medium text-white/90 mb-1">
                        User
                      </label>
                      <select
                        id="change-password-user"
                        value={changePasswordUserId}
                        onChange={(e) => setChangePasswordUserId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-white/20 bg-white/10 text-black cursor-pointer"
                        required
                      >
                        <option value="">Select user...</option>
                        {changePasswordUserList.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name?.trim() || u.email || u.id}
                            {u.email ? ` (${u.email})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="new-password" className="block text-sm font-medium text-white/90 mb-1">
                        New password
                      </label>
                      <div className="relative">
                        <input
                          id="new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          value={changePasswordNew}
                          onChange={(e) => setChangePasswordNew(e.target.value)}
                          className="w-full px-3 py-2 pr-10 rounded-lg border border-white/20 bg-white/10 text-white placeholder-white/50"
                          placeholder="At least 6 characters"
                          required
                          minLength={6}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/60 hover:text-white rounded"
                          aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                        >
                          {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="confirm-password" className="block text-sm font-medium text-white/90 mb-1">
                        Confirm new password
                      </label>
                      <div className="relative">
                        <input
                          id="confirm-password"
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={changePasswordConfirm}
                          onChange={(e) => setChangePasswordConfirm(e.target.value)}
                          className="w-full px-3 py-2 pr-10 rounded-lg border border-white/20 bg-white/10 text-white placeholder-white/50"
                          placeholder="Confirm new password"
                          required
                          minLength={6}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/60 hover:text-white rounded"
                          aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        >
                          {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                    {changePasswordError && (
                      <p className="text-sm text-red-400">{changePasswordError}</p>
                    )}
                    {changePasswordSuccess && (
                      <p className="text-sm text-green-400 flex items-center gap-2">
                        <Check size={16} />
                        Password changed successfully.
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={changePasswordLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {changePasswordLoading ? 'Updating...' : 'Change password'}
                    </button>
                  </form>
                </div>
              )}

              {activeTab === 'unlock' && variant === 'super_admin' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Locked Sheets</h2>
                  <div className="space-y-4">
                    {lockedSheets.map((sheet) => (
                      <div
                        key={sheet.id}
                        className="border border-white/20 rounded-lg p-4 flex justify-between items-center bg-white/5"
                      >
                        <div>
                          <p className="font-medium text-white">
                            Sheet for Month {sheet.month}/{sheet.year}
                          </p>
                          <p className="text-sm text-white/80">
                            Locked columns: {sheet.locked_columns.join(', ') || 'None'}
                          </p>
                          <p className="text-xs text-white/60 mt-1">
                            Locked: {formatDateTime(sheet.updated_at)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleUnlockSheet(sheet.id)}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                          <Unlock size={16} />
                          Unlock
                        </button>
                      </div>
                    ))}
                    {lockedSheets.length === 0 && (
                      <p className="text-center text-white/60 py-8">No locked sheets</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'month-close' && variant === 'admin' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Month Close & Locking</h2>
                  <MonthCloseTab />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showUserForm && (
        <UserFormModal
          user={editingUser}
          providers={providers}
          providerLevelsMap={providerLevelsMap}
          variant={variant}
          onClose={() => {
            setShowUserForm(false)
            setEditingUser(null)
          }}
          onSave={handleSaveUser}
        />
      )}

      {showBillingCodeForm && (
        <BillingCodeFormModal
          code={editingBillingCode}
          onClose={() => {
            setShowBillingCodeForm(false)
            setEditingBillingCode(null)
          }}
          onSave={handleSaveBillingCode}
        />
      )}

      {showClinicForm && (
        <ClinicFormModal
          clinic={editingClinic}
          onClose={() => {
            setShowClinicForm(false)
            setEditingClinic(null)
          }}
          onSave={handleSaveClinic}
        />
      )}

      {showAddClinicAddressModal && (
        <ClinicAddressModal
          clinics={clinics}
          onClose={() => setShowAddClinicAddressModal(false)}
          onSave={async () => {
            setShowAddClinicAddressModal(false)
            await fetchClinics()
          }}
        />
      )}

      {showAssignClinicModal && assignClinicUser && (
        <AssignClinicsModal
          user={assignClinicUser}
          clinics={clinics}
          clinicAddressesByClinic={clinicAddressesByClinic}
          onClose={() => {
            setShowAssignClinicModal(false)
            setAssignClinicUser(null)
          }}
          onSave={(clinicIds) => handleSaveAssignClinics(assignClinicUser, clinicIds)}
        />
      )}

      {showToggleActiveModal && userToToggleActive && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Change active status</h2>
              <button
                onClick={() => {
                  setShowToggleActiveModal(false)
                  setUserToToggleActive(null)
                  setToggleActivePassword('')
                  setToggleActiveError('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-700">
                {userToToggleActive.active !== false
                  ? `Deactivate ${userToToggleActive.email}?`
                  : `Activate ${userToToggleActive.email}?`}
                {' '}Enter your password to confirm.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your password (super admin)</label>
                <input
                  type="password"
                  value={toggleActivePassword}
                  onChange={(e) => {
                    setToggleActivePassword(e.target.value)
                    setToggleActiveError('')
                  }}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                  disabled={toggleActiveLoading}
                />
                {toggleActiveError && (
                  <p className="text-sm text-red-600 mt-1">{toggleActiveError}</p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowToggleActiveModal(false)
                    setUserToToggleActive(null)
                    setToggleActivePassword('')
                    setToggleActiveError('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  disabled={toggleActiveLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmToggleActive}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  disabled={toggleActiveLoading}
                >
                  {toggleActiveLoading ? 'Updating...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteUserModal && userToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Delete user</h2>
              <button
                onClick={() => {
                  setShowDeleteUserModal(false)
                  setUserToDelete(null)
                  setDeleteUserPassword('')
                  setDeleteUserError('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-700">
                Permanently delete <strong>{userToDelete.email}</strong>? This cannot be undone. Enter your password to confirm.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your password (super admin)</label>
                <input
                  type="password"
                  value={deleteUserPassword}
                  onChange={(e) => {
                    setDeleteUserPassword(e.target.value)
                    setDeleteUserError('')
                  }}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                  disabled={deleteUserLoading}
                />
                {deleteUserError && (
                  <p className="text-sm text-red-600 mt-1">{deleteUserError}</p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteUserModal(false)
                    setUserToDelete(null)
                    setDeleteUserPassword('')
                    setDeleteUserError('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  disabled={deleteUserLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteUser}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  disabled={deleteUserLoading}
                >
                  {deleteUserLoading ? 'Deleting...' : 'Delete user'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteClinicModal && clinicToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Delete clinic</h2>
              <button
                onClick={() => {
                  setShowDeleteClinicModal(false)
                  setClinicToDelete(null)
                  setDeleteClinicPassword('')
                  setDeleteClinicError('')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-700">
                Permanently delete clinic <strong>{clinicToDelete.name}</strong>? This will remove all related data (patients, providers, sheets, etc.) and cannot be undone. Enter your password to confirm.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your password (super admin)</label>
                <input
                  type="password"
                  value={deleteClinicPassword}
                  onChange={(e) => {
                    setDeleteClinicPassword(e.target.value)
                    setDeleteClinicError('')
                  }}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                  disabled={deleteClinicLoading}
                />
                {deleteClinicError && (
                  <p className="text-sm text-red-600 mt-1">{deleteClinicError}</p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteClinicModal(false)
                    setClinicToDelete(null)
                    setDeleteClinicPassword('')
                    setDeleteClinicError('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  disabled={deleteClinicLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteClinic}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                  disabled={deleteClinicLoading}
                >
                  {deleteClinicLoading ? 'Deleting...' : 'Delete clinic'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UserFormModal({
  user,
  providers,
  providerLevelsMap,
  variant,
  onClose,
  onSave,
}: {
  user: User | null
  providers: Provider[]
  providerLevelsMap: Record<string, number>
  variant: Variant | null
  onSave: (data: Partial<User>, providerLevel?: number, providerCutPercent?: number, temporaryPassword?: string, showVisitTypeColumn?: boolean) => Promise<void>
  onClose: () => void
}) {
  const providersForUser = user?.role === 'provider' && user?.email ? providers.filter(p => p.email === user.email) : []
  const initialLevel = providersForUser.length > 0 ? (providerLevelsMap[providersForUser[0].id] ?? 1) : 1
  const initialCutPercent = providersForUser.length > 0 ? (providersForUser[0].provider_cut_percent ?? 0.7) : 0.7
  const initialShowVisitTypeColumn = providersForUser.length > 0 ? (providersForUser[0].show_visit_type_column ?? false) : false
  const parseFullName = (full: string) => {
    const trimmed = (full || '').trim()
    const spaceIdx = trimmed.indexOf(' ')
    return {
      first_name: spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed,
      last_name: spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '',
    }
  }
  const initialName = parseFullName(user?.full_name || '')
  const initialNpi = user?.role === 'provider' && providersForUser.length > 0 ? (providersForUser[0].npi ?? '') : ''
  const [formData, setFormData] = useState({
    email: user?.email || '',
    first_name: initialName.first_name,
    last_name: initialName.last_name,
    role: user?.role || 'provider',
    clinic_ids: user?.clinic_ids || [],
    highlight_color: user?.highlight_color || (user?.role === 'super_admin' ? '#2d7e83' : '#eab308'),
    provider_level: initialLevel as 1 | 2,
    provider_cut_percent: initialCutPercent,
    show_visit_type_column: initialShowVisitTypeColumn,
    hourly_pay: user?.hourly_pay ?? '',
    password: '',
    npi: initialNpi,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { provider_level, provider_cut_percent, show_visit_type_column, hourly_pay, password, first_name, last_name, npi, ...rest } = formData
    const full_name = [first_name, last_name].map(s => (s || '').trim()).filter(Boolean).join(' ') || undefined
    const userData = {
      ...rest,
      full_name: full_name || null,
      hourly_pay: hourly_pay === '' || hourly_pay == null ? null : Number(hourly_pay),
      ...(formData.role === 'provider' && { npi: (npi || '').trim() || null }),
    }
    await onSave(
      userData,
      formData.role === 'provider' ? provider_level : undefined,
      formData.role === 'provider' ? provider_cut_percent : undefined,
      user ? undefined : password,
      formData.role === 'provider' ? show_visit_type_column : undefined
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {user ? 'Edit User' : 'Add User'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div className={user ? 'col-span-2' : ''}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
            </div>

            {!user && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Temporary password</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Min 6 characters"
                  minLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                />
                <p className="text-xs text-gray-500 mt-1">User will sign in with this password; they can change it later.</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              >
                {/* <option value="super_admin">Super Admin</option> */}
                <option value="admin">Admin</option>
                {/* <option value="view_only_admin">View-Only Admin</option> */}
                <option value="billing_staff">Billing Staff</option>
                {/* <option value="view_only_billing">View-Only Billing</option> */}
                {/* <option value="official_staff">Official Staff</option> */}
                <option value="provider">Provider</option>
                <option value="office_staff">Office Staff</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hourly pay amount</label>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="e.g. 25.00"
                value={formData.hourly_pay === '' ? '' : formData.hourly_pay}
                onChange={(e) => setFormData({ ...formData, hourly_pay: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
              <p className="text-xs text-gray-500 mt-1">Stored on user and applied to timecard entries.</p>
            </div>

            {formData.role === 'provider' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">NPI</label>
                <input
                  type="text"
                  value={formData.npi}
                  onChange={(e) => setFormData({ ...formData, npi: e.target.value })}
                  placeholder="National Provider Identifier"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                />
              </div>
            )}

            {variant === 'super_admin' && formData.role === 'provider' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Provider Level</label>
                  <select
                    value={formData.provider_level}
                    onChange={(e) => setFormData({ ...formData, provider_level: Number(e.target.value) as 1 | 2 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                  >
                    <option value={1}>Partial</option>
                    <option value={2}>Full</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Partial or Full (default is Partial).</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Provider cut %</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={formData.provider_cut_percent}
                    onChange={(e) => setFormData({ ...formData, provider_cut_percent: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                  />
                  <p className="text-xs text-gray-500 mt-1">Decimal 0–1 (e.g. 0.7 = 70%). Default 0.7. Provider Cut = Total Payments × this.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show_visit_type_column"
                    checked={formData.show_visit_type_column}
                    onChange={(e) => setFormData({ ...formData, show_visit_type_column: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="show_visit_type_column" className="text-sm font-medium text-gray-700">
                    Show Visit Type column (In-person / Telehealth) in Providers tab
                  </label>
                </div>
                <p className="text-xs text-gray-500 -mt-2">When on, this provider&apos;s sheet shows an extra column to mark each visit as In-person or Telehealth.</p>
              </>
            )}

            {variant === 'super_admin' && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Highlight Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formData.highlight_color}
                    onChange={(e) => setFormData({ ...formData, highlight_color: e.target.value })}
                    className="h-10 w-14 border border-gray-300 rounded-lg cursor-pointer"
                  />
                  <span className="text-sm text-gray-600 font-mono">{formData.highlight_color}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Shown in the table and used for this user&apos;s highlight. Default: yellow.</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-6 mt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BillingCodeFormModal({
  code,
  onClose,
  onSave,
}: {
  code: BillingCode | null
  onSave: (data: Partial<BillingCode>) => Promise<void>
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    code: code?.code || '',
    description: code?.description || '',
    color: code?.color || '#3b82f6',
    text_color: code?.text_color ?? '#000000',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code.trim()) {
      alert('Code is required')
      return
    }
    await onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {code ? 'Edit Billing Code' : 'Add Billing Code'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
            <input
              type="text"
              required
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Background color</label>
            <input
              type="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="w-full h-10 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Text color</label>
            <input
              type="color"
              value={formData.text_color}
              onChange={(e) => setFormData({ ...formData, text_color: e.target.value })}
              className="w-full h-10 border border-gray-300 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ClinicFormModal({
  clinic,
  onClose,
  onSave,
}: {
  clinic: Clinic | null
  onSave: (data: Partial<Clinic>) => Promise<void>
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: clinic?.name ?? '',
    phone: clinic?.phone ?? '',
    fax: clinic?.fax ?? '',
    npi: clinic?.npi ?? '',
    ein: clinic?.ein ?? '',
    payroll: (clinic?.payroll ?? 1) as 1 | 2,
    invoice_rate: clinic?.invoice_rate != null ? (Math.round(clinic.invoice_rate * 10000) / 100).toFixed(2) : '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      alert('Clinic name is required')
      return
    }
    const rateNum = formData.invoice_rate.trim() ? parseFloat(formData.invoice_rate) : null
    await onSave({
      name: formData.name.trim(),
      phone: formData.phone.trim() || null,
      fax: formData.fax.trim() || null,
      npi: formData.npi.trim() || null,
      ein: formData.ein.trim() || null,
      payroll: formData.payroll,
      invoice_rate: rateNum != null && Number.isFinite(rateNum) ? rateNum / 100 : null,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {clinic ? 'Edit Clinic' : 'Add Clinic'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
            </div>
            <p className="text-sm text-gray-500 md:col-span-2">Use &quot;Add Clinic Address&quot; to manage up to 6 address lines per clinic.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fax</label>
              <input
                type="text"
                value={formData.fax}
                onChange={(e) => setFormData({ ...formData, fax: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">NPI</label>
              <input
                type="text"
                value={formData.npi}
                onChange={(e) => setFormData({ ...formData, npi: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                placeholder="National Provider Identifier"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">EIN</label>
              <input
                type="text"
                value={formData.ein}
                onChange={(e) => setFormData({ ...formData, ein: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                placeholder="Employer Identification Number"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payroll</label>
              <select
                value={formData.payroll}
                onChange={(e) => setFormData({ ...formData, payroll: Number(e.target.value) as 1 | 2 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
              >
                <option value={1}>Once per month</option>
                <option value={2}>Twice per month</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">1 = default; 2 = two pay periods per month (24-item date dropdowns, dual AR/Provider Pay tables)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice rate (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={formData.invoice_rate}
                onChange={(e) => setFormData({ ...formData, invoice_rate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-black"
                placeholder="e.g. 5 for 5%"
              />
              <p className="text-xs text-gray-500 mt-1">Used on Invoices page: Invoice Total = (Insurance + Patient + AR) × this rate. Leave empty for none.</p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6 mt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ClinicAddressModal({
  clinics,
  onClose,
  onSave,
}: {
  clinics: Clinic[]
  onClose: () => void
  onSave: () => Promise<void>
}) {
  const [selectedClinicId, setSelectedClinicId] = useState<string>('')
  const [addresses, setAddresses] = useState<string[]>(() => Array(6).fill(''))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedClinicId) {
      setAddresses(Array(6).fill(''))
      setLoadError(null)
      return
    }
    let cancelled = false
    setLoadError(null)
    setLoading(true)
    apiClient
      .from('clinic_addresses')
      .select('line_index, address')
      .eq('clinic_id', selectedClinicId)
      .order('line_index')
      .then(({ data, error }) => {
        if (cancelled) return
        setLoading(false)
        if (error) {
          setLoadError(error.message)
          return
        }
        const next = Array(6).fill('')
        ;(data as { line_index: number; address: string | null }[] | null)?.forEach((row) => {
          const i = row.line_index - 1
          if (i >= 0 && i < 6) next[i] = row.address ?? ''
        })
        setAddresses(next)
      })
    return () => { cancelled = true }
  }, [selectedClinicId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedClinicId.trim()) {
      alert('Please select a clinic.')
      return
    }
    setSaving(true)
    try {
      for (let i = 0; i < 6; i++) {
        const lineIndex = i + 1
        const address = addresses[i]?.trim() ?? null
        const { error } = await apiClient
          .from('clinic_addresses')
          .upsert(
            {
              clinic_id: selectedClinicId,
              line_index: lineIndex,
              address: address || null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'clinic_id,line_index' }
          )
        if (error) throw error
      }
      await onSave()
      onClose()
    } catch (err: unknown) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Failed to save addresses.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Add Clinic Address</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Clinic</label>
              <select
                value={selectedClinicId}
                onChange={(e) => setSelectedClinicId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
              >
                <option value="">Select a clinic</option>
                {clinics.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {loading && (
              <p className="text-sm text-gray-500">Loading addresses...</p>
            )}
            {loadError && (
              <p className="text-sm text-red-600">{loadError}</p>
            )}

            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address {n}</label>
                <input
                  type="text"
                  value={addresses[n - 1] ?? ''}
                  onChange={(e) => {
                    const next = [...addresses]
                    next[n - 1] = e.target.value
                    setAddresses(next)
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  placeholder={`Address line ${n}`}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-6 mt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !selectedClinicId}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AssignClinicsModal({
  user,
  clinics,
  clinicAddressesByClinic = {},
  onClose,
  onSave,
}: {
  user: User
  clinics: Clinic[]
  clinicAddressesByClinic?: Record<string, string[]>
  onClose: () => void
  onSave: (clinicIds: string[]) => Promise<void>
}) {
  const [selectedClinicIds, setSelectedClinicIds] = useState<Set<string>>(
    () => new Set(user.clinic_ids || [])
  )

  const isOfficeStaff = user.role === 'office_staff'

  const toggleClinic = (clinicId: string) => {
    setSelectedClinicIds((prev) => {
      const next = new Set(prev)
      if (next.has(clinicId)) {
        next.delete(clinicId)
        return next
      }
      if (isOfficeStaff && next.size >= 1) {
        alert('Office staff can be assigned only one clinic. Please remove the current selection first if you want to change it.')
        return prev
      }
      next.add(clinicId)
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isOfficeStaff && selectedClinicIds.size > 1) {
      alert('Office staff can be assigned only one clinic. Please select only one clinic.')
      return
    }
    await onSave(Array.from(selectedClinicIds))
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Assign Clinics — {user.full_name || user.email}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-6 overflow-y-auto flex-1">
            <p className="text-sm text-gray-600 mb-4">
              Select clinics to assign to this user. Provider, admin, and billing staff may have multiple clinics. Office staff can be assigned only one clinic.
            </p>
            {isOfficeStaff && (
              <p className="text-sm text-amber-600 font-medium mb-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Office staff: only one clinic can be assigned. Selecting another clinic will show a warning.
              </p>
            )}
            <div className="space-y-2">
              {clinics.map((clinic) => (
                <label
                  key={clinic.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedClinicIds.has(clinic.id)}
                    onChange={() => toggleClinic(clinic.id)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="font-medium text-gray-900">{clinic.name}</span>
                  {(clinicAddressesByClinic[clinic.id]?.[0]?.trim()) && (
                    <span className="text-sm text-gray-500 truncate flex-1">{clinicAddressesByClinic[clinic.id][0]}</span>
                  )}
                </label>
              ))}
            </div>
            {clinics.length === 0 && (
              <p className="text-sm text-gray-500">No clinics available.</p>
            )}
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
