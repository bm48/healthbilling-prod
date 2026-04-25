import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Timecard, User } from '@/types'
import type { Clinic } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Lock, LogIn, LogOut, Pencil, Plus, Trash2, Unlock } from 'lucide-react'

export default function Timecards() {
  const { user, userProfile } = useAuth()
  const [timecards, setTimecards] = useState<Timecard[]>([])
  // const [clinics, setClinics] = useState<Clinic[]>([])
  const [selectedClinic, setSelectedClinic] = useState<string>('')
  const [currentClockIn, setCurrentClockIn] = useState<Timecard | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    clock_in: '',
    clock_out: '',
    notes: '',
  })
  const isSuperAdmin = userProfile?.role === 'super_admin'
  const [staffTimecards, setStaffTimecards] = useState<Timecard[]>([])
  const [staffUsers, setStaffUsers] = useState<User[]>([])
  const [clinicsMap, setClinicsMap] = useState<Record<string, string>>({})
  const [editingTimecard, setEditingTimecard] = useState<Timecard | null>(null)
  const [editForm, setEditForm] = useState({ clock_in: '', clock_out: '', notes: '' })

  useEffect(() => {
    if (user && userProfile) {
      loadClinics()
      if (!isSuperAdmin) {
        loadCurrentClockIn()
      }
      loadTimecards()
      if (isSuperAdmin) {
        loadStaffTimecards()
      }
    }
  }, [user, userProfile, isSuperAdmin])

  async function loadClinics() {
    if (!userProfile?.clinic_ids.length) return

    const { data } = await apiClient
      .from('clinics')
      .select('*')
      .in('id', userProfile.clinic_ids)

    if (data) {
      // setClinics(data)
      if (data.length > 0) {
        setSelectedClinic(data[0].id)
      }
    }
  }

  async function loadCurrentClockIn() {
    if (!user) return
    
    const { data } = await apiClient
      .from('timecards')
      .select('*')
      .eq('user_id', user.id)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      setCurrentClockIn(data)
    }
  }

  async function loadTimecards() {
    if (!user) return
    
    const { data } = await apiClient
      .from('timecards')
      .select('*')
      .eq('user_id', user.id)
      .order('clock_in', { ascending: false })
      .limit(10)

    if (data) {
      setTimecards(data)
    }
  }

  async function loadStaffTimecards() {
    const { data: usersData } = await apiClient
      .from('users')
      .select('*')
      .in('role', ['billing_staff', 'office_staff'])
    if (!usersData?.length) {
      setStaffUsers([])
      setStaffTimecards([])
      setClinicsMap({})
      return
    }
    setStaffUsers(usersData)
    const userIds = usersData.map((u) => u.id)
    const { data: tcData } = await apiClient
      .from('timecards')
      .select('*')
      .in('user_id', userIds)
    const timecardsList = tcData ?? []
    setStaffTimecards(timecardsList)

    const clinicIdsFromTimecards = [...new Set(timecardsList.map((tc) => tc.clinic_id).filter(Boolean) as string[])]
    const clinicIdsFromUsers = [...new Set(usersData.flatMap((u) => u.clinic_ids || []))]
    const clinicIds = [...new Set([...clinicIdsFromUsers, ...clinicIdsFromTimecards])]
    if (clinicIds.length > 0) {
      const { data: clinicsData } = await apiClient
        .from('clinics')
        .select('id, name')
        .in('id', clinicIds)
      const map: Record<string, string> = {}
      ;(clinicsData as Pick<Clinic, 'id' | 'name'>[] | null)?.forEach((c) => {
        map[c.id] = c.name
      })
      setClinicsMap(map)
    } else {
      setClinicsMap({})
    }
  }

  const handleClockIn = async () => {
    if (!selectedClinic || !user) return

    const now = new Date()
    // Calculate week start date (Monday of current week)
    const weekStart = new Date(now)
    const day = weekStart.getDay()
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)

    const { data, error } = await apiClient
      .from('timecards')
      .insert({
        user_id: user.id,
        clinic_id: selectedClinic,
        clock_in: now.toISOString(),
        week_start_date: weekStart.toISOString().split('T')[0], // YYYY-MM-DD format
        hourly_pay: userProfile?.hourly_pay ?? null,
      })
      .select()
      .maybeSingle()

    if (error) {
      alert('Failed to clock in. Please try again.')
      return
    }

    if (data) {
      setCurrentClockIn(data)
      loadTimecards()
    }
  }

  const handleClockOut = async () => {
    if (!currentClockIn) return

    const clockOutTime = new Date()
    const clockInTime = new Date(currentClockIn.clock_in)
    const hours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60)

    await apiClient
      .from('timecards')
      .update({
        clock_out: clockOutTime.toISOString(),
        hours: Math.round(hours * 100) / 100,
      })
      .eq('id', currentClockIn.id)

    setCurrentClockIn(null)
    loadTimecards()
  }

  const handleManualEntry = async () => {
    if (!selectedClinic || !formData.clock_in || !formData.clock_out || !user) return

    const clockOutTime = new Date(formData.clock_out)
    const clockInTime = new Date(formData.clock_in)
    const hours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60)

    // Calculate week start date (Monday of the week containing clock_in)
    const weekStart = new Date(clockInTime)
    const day = weekStart.getDay()
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)

    const { error } = await apiClient.from('timecards').insert({
      user_id: user.id,
      clinic_id: selectedClinic,
      clock_in: formData.clock_in,
      clock_out: formData.clock_out,
      hours: Math.round(hours * 100) / 100,
      hourly_pay: userProfile?.hourly_pay ?? null,
      notes: formData.notes || null,
      week_start_date: weekStart.toISOString().split('T')[0], // YYYY-MM-DD format
    })

    if (error) {
      alert('Failed to create time entry. Please try again.')
      return
    }

    setShowModal(false)
    setFormData({ clock_in: '', clock_out: '', notes: '' })
    loadTimecards()
  }

  const toDatetimeLocal = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const handleOpenEdit = (tc: Timecard) => {
    setEditingTimecard(tc)
    setEditForm({
      clock_in: toDatetimeLocal(tc.clock_in),
      clock_out: tc.clock_out ? toDatetimeLocal(tc.clock_out) : '',
      notes: tc.notes || '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editingTimecard || !editForm.clock_in || !editForm.clock_out) return
    const clockInTime = new Date(editForm.clock_in)
    const clockOutTime = new Date(editForm.clock_out)
    const hours = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60)
    const weekStart = new Date(clockInTime)
    const day = weekStart.getDay()
    const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1)
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)
    const { error } = await apiClient
      .from('timecards')
      .update({
        clock_in: clockInTime.toISOString(),
        clock_out: clockOutTime.toISOString(),
        hours: Math.round(hours * 100) / 100,
        notes: editForm.notes || null,
        week_start_date: weekStart.toISOString().split('T')[0],
      })
      .eq('id', editingTimecard.id)
    if (error) {
      alert('Failed to update timecard: ' + (error.message || 'Unknown error'))
      return
    }
    setEditingTimecard(null)
    loadStaffTimecards()
  }

  const handleDeleteTimecard = async (tc: Timecard) => {
    if (!confirm(`Delete this timecard (${asHours(tc.hours).toFixed(2)} hrs)?`)) return
    const { error } = await apiClient.from('timecards').delete().eq('id', tc.id)
    if (error) {
      alert('Failed to delete timecard.')
      return
    }
    loadStaffTimecards()
  }

  const handleDeleteWeeklyRow = async (row: StaffWeekRow) => {
    const timecardsInRow = staffTimecards.filter(
      (tc) => tc.user_id === row.userId && getWeekStart(tc) === row.weekStart
    )
    const locked = timecardsInRow.some((tc) => tc.is_locked)
    if (locked) {
      alert('Cannot delete: one or more timecards in this week are locked.')
      return
    }
    const name = staffUserById[row.userId] ? userName(staffUserById[row.userId]) : row.userId
    if (!confirm(`Delete all time entries for ${name} for the week of ${formatWeekRange(row.weekStart)} (${timecardsInRow.length} entries, ${row.totalHours.toFixed(2)} hrs)?`)) return
    const ids = timecardsInRow.map((tc) => tc.id)
    const { error } = await apiClient.from('timecards').delete().in('id', ids)
    if (error) {
      alert('Failed to delete timecards.')
      return
    }
    loadStaffTimecards()
  }

  const handleToggleLock = async (tc: Timecard) => {
    const nextLocked = !(tc.is_locked ?? false)
    const { error } = await apiClient
      .from('timecards')
      .update({ is_locked: nextLocked })
      .eq('id', tc.id)
    if (error) {
      alert('Failed to update lock.')
      return
    }
    loadStaffTimecards()
  }

  const asHours = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  }

  // Working time per entry = clock_out - clock_in (stored as tc.hours). Weekly total = sum of those hours for all entries in that week. Average weekly = sum of all weekly totals / number of weeks.
  const totalHours = timecards
    .filter((tc) => asHours(tc.hours) > 0)
    .reduce((sum, tc) => sum + asHours(tc.hours), 0)

  const getWeekStart = (tc: Timecard): string => {
    if (tc.week_start_date) return tc.week_start_date
    const d = new Date(tc.clock_in)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const weekStart = new Date(d)
    weekStart.setDate(diff)
    weekStart.setHours(0, 0, 0, 0)
    return weekStart.toISOString().split('T')[0]
  }
  // Group by week: each week's total = sum of (clock_out - clock_in) for every entry in that week
  const hoursByWeek = timecards
    .filter((tc) => asHours(tc.hours) > 0)
    .reduce<Record<string, number>>((acc, tc) => {
      const week = getWeekStart(tc)
      acc[week] = (acc[week] || 0) + asHours(tc.hours)
      return acc
    }, {})
  const weekEntries = Object.entries(hoursByWeek)
    .map(([date, hours]) => ({ date, hours }))
    .sort((a, b) => b.date.localeCompare(a.date))
  const averageHoursPerWeek = weekEntries.length > 0 ? totalHours / weekEntries.length : 0

  const hoursByUserId = staffTimecards
    .filter((tc) => tc.hours != null)
    .reduce<Record<string, number>>((acc, tc) => {
      acc[tc.user_id] = (acc[tc.user_id] ?? 0) + asHours(tc.hours)
      return acc
    }, {})
  const billingStaffUsers = staffUsers.filter((u) => u.role === 'billing_staff')
  const officeStaffUsers = staffUsers.filter((u) => u.role === 'office_staff')
  const userName = (u: User) => u.full_name?.trim() || u.email || '—'
  const userClinicNames = (u: User) => {
    const ids = u.clinic_ids || []
    if (ids.length === 0) return '—'
    return ids.map((id) => clinicsMap[id] || id).join(', ')
  }
  const staffUserById = staffUsers.reduce<Record<string, User>>((acc, u) => {
    acc[u.id] = u
    return acc
  }, {})
  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  const recentStaffTimecards = [...staffTimecards]
    .filter((tc) => new Date(tc.clock_in) >= oneWeekAgo)
    .sort((a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime())

  // Weekly summary for super admin: name, week, dates worked, total hours (per staff per week)
  type StaffWeekRow = { userId: string; weekStart: string; datesWorked: string; totalHours: number }
  const staffWeekRows: StaffWeekRow[] = (() => {
    const withHours = staffTimecards.filter((tc) => tc.hours != null)
    const byKey = new Map<string, { userId: string; weekStart: string; dateStrings: Set<string>; totalHours: number }>()
    for (const tc of withHours) {
      const weekStart = getWeekStart(tc)
      const key = `${tc.user_id}|${weekStart}`
      const dateStr = new Date(tc.clock_in).toISOString().slice(0, 10)
      if (!byKey.has(key)) {
        byKey.set(key, { userId: tc.user_id, weekStart, dateStrings: new Set(), totalHours: 0 })
      }
      const row = byKey.get(key)!
      row.dateStrings.add(dateStr)
      row.totalHours += asHours(tc.hours)
    }
    const rows: StaffWeekRow[] = []
    byKey.forEach((row) => {
      const sortedDates = [...row.dateStrings].sort()
      const datesWorked = sortedDates
        .map((d) => {
          const dt = new Date(d + 'T00:00:00')
          return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })
        })
        .join(', ')
      rows.push({ userId: row.userId, weekStart: row.weekStart, datesWorked, totalHours: row.totalHours })
    })
    return rows.sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.userId.localeCompare(b.userId))
  })()

  const formatWeekRange = (weekStart: string) => {
    const weekStartDate = new Date(weekStart + 'T00:00:00')
    const weekEnd = new Date(weekStartDate)
    weekEnd.setDate(weekEnd.getDate() + 6)
    return weekStartDate.getMonth() === weekEnd.getMonth()
      ? `${weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}-${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
      : `${weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Timecards</h1>
        {
          !isSuperAdmin && (
            <p className="text-white/70">Track your work hours</p>
          )
        }
      </div>

      <div className={`grid gap-6 mb-6 ${isSuperAdmin ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        {!isSuperAdmin && (
          <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4">Clock In/Out</h2>
            {currentClockIn ? (
              <div>
                <p className="text-sm text-white/70 mb-4">
                  Clocked in at: {new Date(currentClockIn.clock_in).toLocaleString()}
                </p>
                <button
                  onClick={handleClockOut}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  <LogOut className="w-5 h-5" />
                  Clock Out
                </button>
              </div>
            ) : (
              <button
                onClick={handleClockIn}
                disabled={!selectedClinic}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                <LogIn className="w-5 h-5" />
                Clock In
              </button>
            )}
            <button
              onClick={() => setShowModal(true)}
              className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-md"
            >
              <Plus className="w-5 h-5" />
              Manual Entry
            </button>
          </div>
        )}

        <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
          <h2 className="text-xl font-semibold text-white mb-4">Summary</h2>
          <div className="space-y-3">
            {isSuperAdmin ? (
              <>
                <div>
                  <h3 className="text-lg font-semibold text-white/90 mb-2 italic">Billing staff</h3>
                  <div className="space-y-1.5">
                    {billingStaffUsers.length === 0 ? (
                      <p className="text-white/50 text-sm pl-4">No billing staff</p>
                    ) : (
                      billingStaffUsers.map((u) => (
                        <div key={u.id} className="flex justify-between items-center gap-4 text-sm flex-wrap">
                          <span className="text-white/80 pl-4 shrink-0">{userName(u)}</span>
                          <span className="text-white/60 flex-1 min-w-0">{userClinicNames(u)}</span>
                          <span className="font-medium text-white shrink-0">{asHours(hoursByUserId[u.id]).toFixed(2)} hrs</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="pt-3 border-t border-white/20">
                  <h3 className="text-lg font-semibold text-white/90 mb-2 italic">Office staff</h3>
                  <div className="space-y-1.5">
                    {officeStaffUsers.length === 0 ? (
                      <p className="text-white/50 text-sm pl-4">No office staff</p>
                    ) : (
                      officeStaffUsers.map((u) => (
                        <div key={u.id} className="flex justify-between items-center gap-4 text-sm flex-wrap">
                          <span className="text-white/80 pl-4 shrink-0">{userName(u)}</span>
                          <span className="text-white/60 flex-1 min-w-0">{userClinicNames(u)}</span>
                          <span className="font-medium text-white shrink-0">{asHours(hoursByUserId[u.id]).toFixed(2)} hrs</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-white/70">Average hours per week</span>
                  <span className="font-semibold text-white text-xl">
                    {averageHoursPerWeek.toFixed(2)} hrs
                  </span>
                </div>
                {userProfile?.hourly_pay != null && userProfile.hourly_pay > 0 && (
                  <div className="flex justify-between items-center pt-2 border-t border-white/20">
                    <span className="text-white/70">Hourly rate</span>
                    <span className="font-semibold text-white">
                      ${Number(userProfile.hourly_pay).toFixed(2)}/hr
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl overflow-hidden border border-white/20">
        <div className="p-4 border-b border-white/20">
          <h2 className="font-semibold text-white">Recent Timecards{isSuperAdmin ? ' (last week)' : ''}</h2>
        </div>
        <div className="table-container dark-theme">
          <table className="table-spreadsheet dark-theme">
            <thead>
              <tr>
                {isSuperAdmin && <th>Staff</th>}
                <th>Date</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Hours</th>
                <th>Notes</th>
                {isSuperAdmin && <th className="w-24">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(isSuperAdmin ? recentStaffTimecards : timecards).map((timecard) => (
                <tr key={timecard.id}>
                  {isSuperAdmin && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {staffUserById[timecard.user_id] ? userName(staffUserById[timecard.user_id]) : timecard.user_id}
                    </td>
                  )}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(timecard.clock_in).toLocaleDateString()}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(timecard.clock_in).toLocaleTimeString()}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {timecard.clock_out ? new Date(timecard.clock_out).toLocaleTimeString() : '00:00'}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {asHours(timecard.hours).toFixed(2)}
                  </td>
                  <td>{timecard.notes || ''}</td>
                  {isSuperAdmin && (
                    <td className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleLock(timecard)}
                          className={`p-1.5 rounded ${timecard.is_locked ? 'text-amber-400 hover:bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                          title={timecard.is_locked ? 'Unlock row' : 'Lock row'}
                        >
                          {timecard.is_locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => !timecard.is_locked && handleOpenEdit(timecard)}
                          disabled={!!timecard.is_locked}
                          className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded disabled:opacity-40 disabled:pointer-events-none"
                          title={timecard.is_locked ? 'Locked' : 'Edit'}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => !timecard.is_locked && handleDeleteTimecard(timecard)}
                          disabled={!!timecard.is_locked}
                          className="p-1.5 text-white/70 hover:text-red-400 hover:bg-white/10 rounded disabled:opacity-40 disabled:pointer-events-none"
                          title={timecard.is_locked ? 'Locked' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 bg-white/10 backdrop-blur-md rounded-lg shadow-xl overflow-hidden border border-white/20">
        <div className="p-4 border-b border-white/20">
          <h2 className="font-semibold text-white">Weekly Summary</h2>
        </div>
        <div className="table-container dark-theme">
          <table className="table-spreadsheet dark-theme">
            <thead>
              <tr>
                {isSuperAdmin ? (
                  <>
                    <th>Name</th>
                    <th>Week</th>
                    <th>Dates worked</th>
                    <th>Hours</th>
                    <th className="w-12">Actions</th>
                  </>
                ) : (
                  <>
                    <th>Week</th>
                    <th>Hours</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {isSuperAdmin ? (
                staffWeekRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-white/60 text-center py-6">
                      No hours recorded yet.
                    </td>
                  </tr>
                ) : (
                  staffWeekRows.map((row) => {
                    const timecardsInRow = staffTimecards.filter(
                      (tc) => tc.user_id === row.userId && getWeekStart(tc) === row.weekStart
                    )
                    const hasLocked = timecardsInRow.some((tc) => tc.is_locked)
                    return (
                      <tr key={`${row.userId}-${row.weekStart}`}>
                        <td style={{ whiteSpace: 'nowrap' }} className="text-white/90">
                          {staffUserById[row.userId] ? userName(staffUserById[row.userId]) : row.userId}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }} className="text-white/90">{formatWeekRange(row.weekStart)}</td>
                        <td className="text-white/80">{row.datesWorked}</td>
                        <td style={{ fontWeight: 500 }} className="text-white">{row.totalHours.toFixed(2)} hrs</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => !hasLocked && handleDeleteWeeklyRow(row)}
                            disabled={hasLocked}
                            className="p-1.5 text-white/70 hover:text-red-400 hover:bg-white/10 rounded disabled:opacity-40 disabled:pointer-events-none"
                            title={hasLocked ? 'Week has locked entries' : 'Delete all entries for this week'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )
              ) : weekEntries.length === 0 ? (
                <tr>
                  <td colSpan={2} className="text-white/60 text-center py-6">
                    No hours recorded yet.
                  </td>
                </tr>
              ) : (
                weekEntries.map(({ date, hours }) => {
                  const weekStart = new Date(date + 'T00:00:00')
                  const weekEnd = new Date(weekStart)
                  weekEnd.setDate(weekEnd.getDate() + 6)
                  const dateRange = weekStart.getMonth() === weekEnd.getMonth()
                    ? `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}-${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
                    : `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                  return (
                    <tr key={date}>
                      <td style={{ whiteSpace: 'nowrap' }} className="text-white/90">{dateRange}</td>
                      <td style={{ fontWeight: 500 }} className="text-white">{hours.toFixed(2)} hrs</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800/95 backdrop-blur-md rounded-lg p-6 w-full max-w-md border border-white/20">
            <h2 className="text-xl font-bold text-white mb-4">Manual Time Entry</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Clock In</label>
                <input
                  type="datetime-local"
                  value={formData.clock_in}
                  onChange={(e) => setFormData({ ...formData, clock_in: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Clock Out</label>
                <input
                  type="datetime-local"
                  value={formData.clock_out}
                  onChange={(e) => setFormData({ ...formData, clock_out: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md placeholder-white/50"
                  rows={3}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-4 justify-end">
              <button
                onClick={() => {
                  setShowModal(false)
                  setFormData({ clock_in: '', clock_out: '', notes: '' })
                }}
                className="px-4 py-2 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleManualEntry}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTimecard && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800/95 backdrop-blur-md rounded-lg p-6 w-full max-w-md border border-white/20">
            <h2 className="text-xl font-bold text-white mb-4">Edit Timecard</h2>
            {staffUserById[editingTimecard.user_id] && (
              <p className="text-white/70 text-sm mb-4">{userName(staffUserById[editingTimecard.user_id])}</p>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Clock In</label>
                <input
                  type="datetime-local"
                  value={editForm.clock_in}
                  onChange={(e) => setEditForm({ ...editForm, clock_in: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Clock Out</label>
                <input
                  type="datetime-local"
                  value={editForm.clock_out}
                  onChange={(e) => setEditForm({ ...editForm, clock_out: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md placeholder-white/50"
                  rows={3}
                />
              </div>
            </div>
            <div className="mt-6 flex gap-4 justify-end">
              <button
                onClick={() => {
                  setEditingTimecard(null)
                }}
                className="px-4 py-2 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
