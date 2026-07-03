import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Timecard, User } from '@/types'
import type { Clinic } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Lock, LogIn, LogOut, Pencil, Plus, Printer, Trash2, Unlock } from 'lucide-react'
import { generateTimecardPaystubPdf, paystubFilename, type TimecardPaystubEntry } from '@/lib/timecardPaystubPdf'

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
  // Both super_admin and admin can view + add + edit + delete staff timecards. Previously this
  // was gated on `super_admin` only, which removed admins' ability to correct hours when staff
  // submitted them incorrectly.
  const canManageTimecards =
    userProfile?.role === 'super_admin' || userProfile?.role === 'admin'
  // Personal Clock In/Out is shown to everyone *except* super_admin — admins still log their own
  // hours alongside the staff-management view. (Super admins historically have not been clocked
  // in here; leave that behavior alone.)
  const canSelfClock = userProfile?.role !== 'super_admin'
  // Super admins additionally see + manage admin users' timecards. Admins manage billing/office
  // staff only (they shouldn't be able to edit each other's hours).
  const isSuperAdmin = userProfile?.role === 'super_admin'
  const [staffTimecards, setStaffTimecards] = useState<Timecard[]>([])
  const [staffUsers, setStaffUsers] = useState<User[]>([])
  const [clinicsMap, setClinicsMap] = useState<Record<string, string>>({})
  const [editingTimecard, setEditingTimecard] = useState<Timecard | null>(null)
  const [editForm, setEditForm] = useState({ clock_in: '', clock_out: '', notes: '' })
  const [paystubTarget, setPaystubTarget] = useState<{
    userId: string
    weekStart: string
  } | null>(null)
  const [paystubForm, setPaystubForm] = useState<{
    frequency: 'weekly' | 'biweekly'
    payDate: string
  }>({ frequency: 'weekly', payDate: '' })

  useEffect(() => {
    if (user && userProfile) {
      loadClinics()
      if (canSelfClock) {
        loadCurrentClockIn()
      }
      loadTimecards()
      if (canManageTimecards) {
        loadStaffTimecards()
      }
    }
  }, [user, userProfile, canManageTimecards, canSelfClock, isSuperAdmin])

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
    // Super admin manages admins too (so they can correct admin hours). Admins only see
    // billing/office staff — they shouldn't be able to read/edit each other's timecards.
    const rolesToManage = isSuperAdmin
      ? ['billing_staff', 'office_staff', 'admin']
      : ['billing_staff', 'office_staff']
    const { data: usersData } = await apiClient
      .from('users')
      .select('*')
      .in('role', rolesToManage)
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
    // Week is Sunday–Saturday: subtract getDay() (Sun=0 … Sat=6) from the date to get the Sunday.
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
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

    // Sunday-based week start.
    const weekStart = new Date(clockInTime)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
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
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
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

  // Always compute a Sunday-based week from `clock_in` and return `YYYY-MM-DD`.
  // We deliberately ignore `tc.week_start_date` for grouping/display: rows persisted before the
  // switch from Monday-based to Sunday-based weeks would otherwise show a stale Monday date, and
  // some legacy rows have a full ISO timestamp in that column which broke `formatWeekRange` with
  // "Invalid Date". Recomputing keeps display consistent regardless of what was stored.
  const getWeekStart = (tc: Timecard): string => {
    const d = new Date(tc.clock_in)
    if (Number.isNaN(d.getTime())) return ''
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    weekStart.setHours(0, 0, 0, 0)
    const y = weekStart.getFullYear()
    const m = String(weekStart.getMonth() + 1).padStart(2, '0')
    const day = String(weekStart.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
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
  const adminUsers = staffUsers.filter((u) => u.role === 'admin')
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
    // Accept either `YYYY-MM-DD` or a full ISO timestamp; grab the calendar date part so we don't
    // produce `Invalid Date` when a legacy row stored a timestamp in `week_start_date`.
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(weekStart ?? '')
    if (!ymd) return ''
    const weekStartDate = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    const weekEnd = new Date(weekStartDate)
    weekEnd.setDate(weekEnd.getDate() + 6)
    return weekStartDate.getMonth() === weekEnd.getMonth()
      ? `${weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}-${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
      : `${weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }

  // Open the paystub modal for a given staff week (admin flow) or the current user's own week
  // (self-serve flow). Defaults the pay date to today, which matches how most clients cut checks.
  const openPaystubModal = (userId: string, weekStart: string) => {
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    setPaystubTarget({ userId, weekStart })
    setPaystubForm({
      frequency: 'weekly',
      payDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    })
  }

  // Build the paystub PDF from the target staff week + user's hourly rate. For biweekly we merge
  // the target week with the week immediately before it (same user); each day still shows its own
  // hours row so the employee can see the breakdown.
  const generatePaystubForTarget = () => {
    if (!paystubTarget) return
    const target = paystubTarget
    // Assemble the pool of timecards this user has. For self-serve, `staffTimecards` will be empty
    // so we fall back to the personal `timecards` array.
    const pool = canManageTimecards ? staffTimecards : timecards
    const userTimecards = pool.filter((tc) => tc.user_id === target.userId && asHours(tc.hours) > 0)
    if (userTimecards.length === 0) {
      alert('No hours recorded for this employee.')
      return
    }

    const employee: User | null =
      staffUserById[target.userId] ??
      (userProfile && userProfile.id === target.userId ? userProfile : null)
    if (!employee) {
      alert('Employee record not found.')
      return
    }
    const hourlyRate =
      typeof employee.hourly_pay === 'number' && Number.isFinite(employee.hourly_pay)
        ? employee.hourly_pay
        : 0

    // Weeks to include (Sunday-based). Biweekly bundles the target week + the preceding week.
    const weekStarts: string[] = [target.weekStart]
    if (paystubForm.frequency === 'biweekly') {
      const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(target.weekStart)
      if (ymd) {
        const prev = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
        prev.setDate(prev.getDate() - 7)
        const y = prev.getFullYear()
        const m = String(prev.getMonth() + 1).padStart(2, '0')
        const d = String(prev.getDate()).padStart(2, '0')
        weekStarts.unshift(`${y}-${m}-${d}`)
      }
    }

    // Group the user's timecards by calendar day within the selected weeks.
    const perDayHours = new Map<string, number>()
    for (const tc of userTimecards) {
      const wk = getWeekStart(tc)
      if (!weekStarts.includes(wk)) continue
      const dt = new Date(tc.clock_in)
      if (Number.isNaN(dt.getTime())) continue
      const y = dt.getFullYear()
      const m = String(dt.getMonth() + 1).padStart(2, '0')
      const d = String(dt.getDate()).padStart(2, '0')
      const key = `${y}-${m}-${d}`
      perDayHours.set(key, (perDayHours.get(key) ?? 0) + asHours(tc.hours))
    }
    const days = [...perDayHours.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours }))
    const totalHours = days.reduce((s, d) => s + d.hours, 0)

    // Pay period label spans the first covered week's Sunday through the target week's Saturday.
    const firstWeek = weekStarts[0]
    const firstYmd = /^(\d{4})-(\d{2})-(\d{2})/.exec(firstWeek)
    const targetYmd = /^(\d{4})-(\d{2})-(\d{2})/.exec(target.weekStart)
    let payPeriodLabel = formatWeekRange(target.weekStart)
    if (firstYmd && targetYmd) {
      const start = new Date(Number(firstYmd[1]), Number(firstYmd[2]) - 1, Number(firstYmd[3]))
      const end = new Date(Number(targetYmd[1]), Number(targetYmd[2]) - 1, Number(targetYmd[3]))
      end.setDate(end.getDate() + 6)
      payPeriodLabel = start.getFullYear() === end.getFullYear()
        ? `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    }

    // Pay date input is `YYYY-MM-DD`; format for the PDF header.
    const payDateLabel = (() => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(paystubForm.payDate)
      if (!m) return new Date().toLocaleDateString()
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      return d.toLocaleDateString()
    })()

    // Clinic block: pick the user's first clinic name as a header line.
    const clinicName = employee.clinic_ids?.[0] ? clinicsMap[employee.clinic_ids[0]] ?? null : null

    const entry: TimecardPaystubEntry = {
      employee_name: employee.full_name?.trim() || employee.email || 'Employee',
      employee_id: null,
      clinic_name: clinicName,
      clinic_address: null,
      clinic_phone: null,
      frequency: paystubForm.frequency,
      pay_period_label: payPeriodLabel,
      pay_date: payDateLabel,
      days,
      total_hours: totalHours,
      hourly_rate: hourlyRate,
      ytd_hours: null,
      ytd_pay: null,
      accent_color: null,
      notes: null,
    }
    const doc = generateTimecardPaystubPdf(entry)
    doc.save(paystubFilename(entry))
    setPaystubTarget(null)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Timecards</h1>
        {
          !canManageTimecards && (
            <p className="text-white/70">Track your work hours</p>
          )
        }
      </div>

      <div className={`grid gap-6 mb-6 ${canSelfClock ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        {canSelfClock && (
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
            {canManageTimecards ? (
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
                {/* Admins section — only super_admin sees admin hours, since admins shouldn't
                    be able to see/edit each other's timecards. */}
                {isSuperAdmin && (
                  <div className="pt-3 border-t border-white/20">
                    <h3 className="text-lg font-semibold text-white/90 mb-2 italic">Admins</h3>
                    <div className="space-y-1.5">
                      {adminUsers.length === 0 ? (
                        <p className="text-white/50 text-sm pl-4">No admins</p>
                      ) : (
                        adminUsers.map((u) => (
                          <div key={u.id} className="flex justify-between items-center gap-4 text-sm flex-wrap">
                            <span className="text-white/80 pl-4 shrink-0">{userName(u)}</span>
                            <span className="text-white/60 flex-1 min-w-0">{userClinicNames(u)}</span>
                            <span className="font-medium text-white shrink-0">{asHours(hoursByUserId[u.id]).toFixed(2)} hrs</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
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
          <h2 className="font-semibold text-white">Recent Timecards{canManageTimecards ? ' (last week)' : ''}</h2>
        </div>
        <div className="table-container dark-theme">
          <table className="table-spreadsheet dark-theme">
            <thead>
              <tr>
                {canManageTimecards && <th>Staff</th>}
                <th>Date</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Hours</th>
                <th>Notes</th>
                {canManageTimecards && <th className="w-24">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(canManageTimecards ? recentStaffTimecards : timecards).map((timecard) => (
                <tr key={timecard.id}>
                  {canManageTimecards && (
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
                  {canManageTimecards && (
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
                {canManageTimecards ? (
                  <>
                    <th>Name</th>
                    <th>Week</th>
                    <th>Dates worked</th>
                    <th>Hours</th>
                    <th className="w-24">Actions</th>
                  </>
                ) : (
                  <>
                    <th>Week</th>
                    <th>Hours</th>
                    <th className="w-16">Paystub</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {canManageTimecards ? (
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
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openPaystubModal(row.userId, row.weekStart)}
                              className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded"
                              title="Print paystub for this week"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => !hasLocked && handleDeleteWeeklyRow(row)}
                              disabled={hasLocked}
                              className="p-1.5 text-white/70 hover:text-red-400 hover:bg-white/10 rounded disabled:opacity-40 disabled:pointer-events-none"
                              title={hasLocked ? 'Week has locked entries' : 'Delete all entries for this week'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )
              ) : weekEntries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-white/60 text-center py-6">
                    No hours recorded yet.
                  </td>
                </tr>
              ) : (
                weekEntries.map(({ date, hours }) => {
                  const dateRange = formatWeekRange(date)
                  return (
                    <tr key={date}>
                      <td style={{ whiteSpace: 'nowrap' }} className="text-white/90">{dateRange}</td>
                      <td style={{ fontWeight: 500 }} className="text-white">{hours.toFixed(2)} hrs</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => user && openPaystubModal(user.id, date)}
                          className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded"
                          title="Print paystub for this week"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </td>
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

      {paystubTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800/95 backdrop-blur-md rounded-lg p-6 w-full max-w-md border border-white/20">
            <h2 className="text-xl font-bold text-white mb-2">Print Paystub</h2>
            <p className="text-white/70 text-sm mb-4">
              {(() => {
                const emp: User | null =
                  staffUserById[paystubTarget.userId] ??
                  (userProfile && userProfile.id === paystubTarget.userId ? userProfile : null)
                const name = emp?.full_name?.trim() || emp?.email || paystubTarget.userId
                return `${name} — Week of ${formatWeekRange(paystubTarget.weekStart)}`
              })()}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Frequency</label>
                <div className="flex gap-2">
                  {(['weekly', 'biweekly'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setPaystubForm((s) => ({ ...s, frequency: f }))}
                      className={`px-3 py-2 rounded-md border text-sm font-medium ${
                        paystubForm.frequency === f
                          ? 'bg-blue-600 text-white border-blue-500'
                          : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
                      }`}
                    >
                      {f === 'weekly' ? 'Weekly (1 week)' : 'Biweekly (2 weeks)'}
                    </button>
                  ))}
                </div>
                {paystubForm.frequency === 'biweekly' && (
                  <p className="text-xs text-white/60 mt-2">
                    Biweekly bundles this week plus the week immediately before it.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1">Pay Date</label>
                <input
                  type="date"
                  value={paystubForm.payDate}
                  onChange={(e) => setPaystubForm((s) => ({ ...s, payDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-md"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-4 justify-end">
              <button
                onClick={() => setPaystubTarget(null)}
                className="px-4 py-2 border border-white/20 bg-white/10 hover:bg-white/20 text-white rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={generatePaystubForTarget}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
