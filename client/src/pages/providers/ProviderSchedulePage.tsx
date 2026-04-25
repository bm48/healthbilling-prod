import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider, ProviderScheduleEntry, Patient } from '@/types'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { DateEditor } from '@/lib/handsontableCustomRenderers'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SCHEDULE_COLUMNS = ['patient_id', 'patient_name', 'insurance', 'copay', 'coinsurance', 'date_of_service'] as const
const COLUMN_TITLES = ['Patient ID', 'Patient Name', 'Insurance', 'Co Pay', 'Co Ins', 'Date of Service']

function createEmptyEntry(index: number, clinicId: string, providerId: string): ProviderScheduleEntry {
  return {
    id: `empty-${index}`,
    clinic_id: clinicId,
    provider_id: providerId,
    patient_id: null,
    patient_name: null,
    insurance: null,
    copay: null,
    coinsurance: null,
    date_of_service: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export default function ProviderSchedulePage() {
  const { user, userProfile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { clinicId: urlClinicId } = useParams<{ clinicId: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [clinic, setClinic] = useState<Clinic | null>(null)
  const [entries, setEntries] = useState<ProviderScheduleEntry[]>([])
  const entriesRef = useRef<ProviderScheduleEntry[]>([])
  const saveEntryRef = useRef<(entryOrId: ProviderScheduleEntry | string) => Promise<void>>(null as any)
  const [saving, setSaving] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date())

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      navigate('/login', { replace: true })
      return
    }
    if (userProfile?.role !== 'provider') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (!urlClinicId) {
      navigate('/providers', { replace: true })
    }
  }, [user, userProfile, authLoading, navigate, urlClinicId])

  const resolveProvider = useCallback(async () => {
    if (!user?.email || userProfile?.role !== 'provider') return
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
      const { data, error: err } = await query.limit(1).maybeSingle()
      if (err) throw err
      if (!data) {
        setError('Your account is not linked to a provider.')
        setProvider(null)
        return
      }
      setProvider(data)
    } catch (e) {
      console.error(e)
      setError('Failed to load provider profile.')
      setProvider(null)
    } finally {
      setLoading(false)
    }
  }, [user?.email, userProfile?.role, userProfile?.clinic_ids])

  useEffect(() => {
    resolveProvider()
  }, [resolveProvider])

  const fetchClinic = useCallback(async (id: string) => {
    const { data } = await apiClient.from('clinics').select('*').eq('id', id).maybeSingle()
    setClinic(data || null)
  }, [])

  // Use clinic from URL; must be one of the provider's clinics
  const clinicId = urlClinicId && provider?.clinic_ids?.includes(urlClinicId) ? urlClinicId : undefined

  useEffect(() => {
    if (!provider || !urlClinicId) return
    if (!provider.clinic_ids?.includes(urlClinicId)) {
      navigate('/providers', { replace: true })
    }
  }, [provider, urlClinicId, navigate])

  const fetchSchedule = useCallback(async () => {
    if (!provider) return
    const cid = clinicId ?? provider.clinic_ids?.[0]
    const year = selectedMonth.getFullYear()
    const month = selectedMonth.getMonth() + 1
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    // Fetch rows with date in selected month OR date_of_service null (unscheduled)
    let queryInRange = apiClient
      .from('provider_schedules')
      .select('*')
      .eq('provider_id', provider.id)
      .gte('date_of_service', startDate)
      .lte('date_of_service', endDate)
    let queryNullDate = apiClient
      .from('provider_schedules')
      .select('*')
      .eq('provider_id', provider.id)
      .is('date_of_service', null)
    if (cid) {
      queryInRange = queryInRange.eq('clinic_id', cid)
      queryNullDate = queryNullDate.eq('clinic_id', cid)
    }
    const [resRange, resNull] = await Promise.all([
      queryInRange.order('date_of_service', { ascending: true }),
      queryNullDate.order('created_at', { ascending: true }),
    ])
    if (resRange.error) {
      console.error(resRange.error)
      setEntries([])
      return
    }
    const inRange = (resRange.data || []) as Array<ProviderScheduleEntry & { copay?: number | string | null; coinsurance?: number | string | null }>
    const withNullDate = (resNull.data || []) as Array<ProviderScheduleEntry & { copay?: number | string | null; coinsurance?: number | string | null }>
    const toEntry = (e: typeof inRange[0]): ProviderScheduleEntry => ({
      ...e,
      copay: e.copay != null ? e.copay : null,
      coinsurance: e.coinsurance != null ? e.coinsurance : null,
    })
    const seen = new Set<string>()
    const list: ProviderScheduleEntry[] = []
    inRange.forEach((e) => {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        list.push(toEntry(e))
      }
    })
    withNullDate.forEach((e) => {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        list.push(toEntry(e))
      }
    })
    list.sort((a, b) => {
      const da = a.date_of_service || ''
      const db = b.date_of_service || ''
      if (da && db) return da.localeCompare(db)
      if (da) return -1
      if (db) return 1
      return 0
    })
    const emptyCount = Math.max(0, 200 - list.length)
    const entryCid = cid ?? ''
    const emptyRows = Array.from({ length: emptyCount }, (_, i) =>
      createEmptyEntry(i, entryCid, provider.id)
    )
    setEntries([...list, ...emptyRows])
  }, [provider, clinicId, selectedMonth])

  useEffect(() => {
    if (provider && clinicId) {
      fetchClinic(clinicId)
      fetchSchedule()
    }
  }, [provider, clinicId, fetchClinic, fetchSchedule])

  const formatMonthYear = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const handlePreviousMonth = () =>
    setSelectedMonth((d) => {
      const n = new Date(d)
      n.setMonth(n.getMonth() - 1)
      return n
    })
  const handleNextMonth = () =>
    setSelectedMonth((d) => {
      const n = new Date(d)
      n.setMonth(n.getMonth() + 1)
      return n
    })

  const saveEntry = useCallback(async (entryOrId: ProviderScheduleEntry | string) => {
    if (!provider) return
    const entry = typeof entryOrId === 'string'
      ? entriesRef.current.find(e => e.id === entryOrId)
      : entryOrId
    if (!entry) return
    const cid = clinicId ?? provider.clinic_ids?.[0] ?? ''
    if (!cid) {
      console.error('Cannot save schedule entry: no clinic context.')
      return
    }
    const isNew = entry.id.startsWith('new-') || entry.id.startsWith('empty-')
    const hasData = !!(
      (entry.patient_id ?? '').toString().trim() ||
      (entry.patient_name ?? '').toString().trim() ||
      (entry.insurance ?? '').toString().trim() ||
      entry.copay != null ||
      entry.coinsurance != null ||
      (entry.date_of_service ?? '').toString().trim()
    )
    if (isNew && !hasData) return
    setSaving(true)
    try {
      // provider_schedules table has numeric copay/coinsurance; send number when parseable, else null
        const copayNum = entry.copay != null && entry.copay.toString().trim() !== '' ? Number(entry.copay) : null
        const coinsNum = entry.coinsurance != null && entry.coinsurance.toString().trim() !== '' ? Number(entry.coinsurance) : null
        const payload = {
          clinic_id: cid,
          provider_id: provider.id,
          patient_id: (entry.patient_id ?? '').toString().trim() || null,
          patient_name: (entry.patient_name ?? '').toString().trim() || null,
          insurance: (entry.insurance ?? '').toString().trim() || null,
          copay: copayNum != null && !Number.isNaN(copayNum) ? copayNum : null,
          coinsurance: coinsNum != null && !Number.isNaN(coinsNum) ? coinsNum : null,
          date_of_service: (entry.date_of_service ?? '').toString().trim() || null,
          updated_at: new Date().toISOString(),
        }
      if (isNew) {
        const { data, error: err } = await apiClient
          .from('provider_schedules')
          .insert(payload)
          .select()
          .single()
        if (err) {
          console.error('Schedule insert error:', err)
          throw err
        }
        setEntries(prev => prev.map(e => (e.id === entry.id ? { ...data, copay: (data as any).copay != null ? String((data as any).copay) : null, coinsurance: (data as any).coinsurance != null ? String((data as any).coinsurance) : null } as ProviderScheduleEntry : e)))
      } else {
        const { error: err } = await apiClient
          .from('provider_schedules')
          .update(payload)
          .eq('id', entry.id)
        if (err) {
          console.error('Schedule update error:', err)
          throw err
        }
      }
    } catch (e) {
      console.error(e)
      alert('Failed to save entry. Check the console for details.')
    } finally {
      setSaving(false)
    }
  }, [provider, clinicId])

  useEffect(() => {
    saveEntryRef.current = saveEntry
  }, [saveEntry])

  const lookupPatientAndFillRow = useCallback(async (rowIndex: number, patientIdValue: string) => {
    if (!clinicId || !patientIdValue.trim()) return
    try {
      const { data: patient, error: err } = await apiClient
        .from('patients')
        .select('first_name, last_name, insurance, copay, coinsurance')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientIdValue.trim())
        .maybeSingle()
      if (err || !patient) return
      const p = patient as Pick<Patient, 'first_name' | 'last_name' | 'insurance' | 'copay' | 'coinsurance'>
      const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null
      const entry = entriesRef.current[rowIndex]
      if (!entry) return
      const updatedEntry: ProviderScheduleEntry = {
        ...entry,
        patient_name: fullName,
        insurance: p.insurance ?? null,
        copay: p.copay ?? null,
        coinsurance: p.coinsurance ?? null,
        updated_at: new Date().toISOString(),
      }
      setEntries(prev => {
        const next = [...prev]
        if (rowIndex >= 0 && rowIndex < next.length) next[rowIndex] = updatedEntry
        return next
      })
      saveEntryRef.current?.(updatedEntry).catch(console.error)
    } catch {
      // ignore lookup errors
    }
  }, [clinicId])

  const deleteEntry = useCallback(async (id: string) => {
    if (!confirm('Delete this schedule entry?')) return
    if (id.startsWith('new-') || id.startsWith('empty-')) {
      setEntries(prev => prev.filter(e => e.id !== id))
      const current = entriesRef.current.filter(e => e.id !== id)
      const needEmpty = 200 - current.length
      if (needEmpty > 0 && provider) {
        const start = current.filter(e => e.id.startsWith('empty-')).length
        const cid = provider.clinic_ids?.[0] ?? ''
        setEntries([...current, ...Array.from({ length: needEmpty }, (_, i) =>
          createEmptyEntry(start + i, cid, provider.id)
        )])
      } else {
        setEntries(current)
      }
      return
    }
    setSaving(true)
    try {
      const { error: err } = await apiClient.from('provider_schedules').delete().eq('id', id)
      if (err) throw err
      setEntries(prev => {
        const next = prev.filter(e => e.id !== id)
        const needEmpty = 200 - next.length
        if (needEmpty > 0 && provider) {
          const start = next.filter(e => e.id.startsWith('empty-')).length
          const cid = provider.clinic_ids?.[0] ?? ''
          return [...next, ...Array.from({ length: needEmpty }, (_, i) =>
            createEmptyEntry(start + i, cid, provider.id)
          )]
        }
        return next
      })
    } catch (e) {
      console.error(e)
      alert('Failed to delete entry.')
    } finally {
      setSaving(false)
    }
  }, [provider])

  const getScheduleHandsontableData = useCallback(() => {
    return entries.map(e => [
      e.patient_id ?? '',
      e.patient_name ?? '',
      e.insurance ?? '',
      e.copay ?? '',
      e.coinsurance ?? '',
      e.date_of_service ?? '',
    ])
  }, [entries])

  const scheduleColumns = [
    { data: 0, title: COLUMN_TITLES[0], type: 'text' as const, width: 120 },
    { data: 1, title: COLUMN_TITLES[1], type: 'text' as const, width: 160 },
    { data: 2, title: COLUMN_TITLES[2], type: 'text' as const, width: 140 },
    { data: 3, title: COLUMN_TITLES[3], type: 'numeric' as const, width: 90, numericFormat: { pattern: '0.00', culture: 'en-US' } },
    { data: 4, title: COLUMN_TITLES[4], type: 'numeric' as const, width: 90, numericFormat: { pattern: '0.00', culture: 'en-US' } },
    { data: 5, title: COLUMN_TITLES[5], type: 'date' as const, width: 120, editor: DateEditor },
  ]

  const handleScheduleChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return
    const current = entriesRef.current.length ? entriesRef.current : entries
    const updated = current.map(e => ({ ...e }))
    const fields = [...SCHEDULE_COLUMNS]

    changes.forEach(([row, col, , newValue]) => {
      while (updated.length <= row) {
        const emptyCount = updated.filter(e => e.id.startsWith('empty-')).length
        if (provider) updated.push(createEmptyEntry(emptyCount, provider.clinic_ids?.[0] ?? '', provider.id))
      }
      const entry = updated[row]
      if (!entry || !provider) return
      const field = fields[col as number]
      if (field === 'copay' || field === 'coinsurance') {
        const str = (newValue === '' || newValue == null) ? null : String(newValue)
        ;(entry as any)[field] = str
      } else if (field) {
        ;(entry as any)[field] = newValue === '' || newValue == null ? null : String(newValue)
      }
      entry.updated_at = new Date().toISOString()
    })

    if (updated.length > 200) updated.splice(200)
    else if (updated.length < 200 && provider) {
      const need = 200 - updated.length
      const start = updated.filter(e => e.id.startsWith('empty-')).length
      const cid = provider.clinic_ids?.[0] ?? ''
      updated.push(...Array.from({ length: need }, (_, i) =>
        createEmptyEntry(start + i, cid, provider.id)
      ))
    }

    entriesRef.current = updated
    setEntries(updated)
    const rowsToSave = new Set(changes.map(([r]) => r))
    rowsToSave.forEach(row => {
      const entry = updated[row]
      if (entry) saveEntry(entry).catch(console.error)
    })
    // When user enters a Patient ID, fill row from patients table
    changes.forEach(([row, col, , newValue]) => {
      if (col === 0 && newValue != null && String(newValue).trim()) {
        lookupPatientAndFillRow(row, String(newValue).trim())
      }
    })
  }, [entries, provider, saveEntry, lookupPatientAndFillRow])

  const handleScheduleContextMenu = useCallback((row: number, _col: number, _event: MouseEvent) => {
    const entry = entries[row]
    if (entry) deleteEntry(entry.id)
  }, [entries, deleteEntry])

  if (authLoading || (userProfile?.role === 'provider' && loading && !provider)) {
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
  if (!provider) return null

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Schedule</h1>
        {clinic && <p className="text-white/70">{clinic.name}</p>}
        {saving && <span className="text-white/50 text-sm ml-2">Saving…</span>}
      </div>

      <div className="mb-4 flex items-center justify-center gap-4 bg-slate-800/50 rounded-lg p-3 border border-slate-700">
        <button
          type="button"
          onClick={handlePreviousMonth}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-white"
          title="Previous month"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-lg font-semibold text-white min-w-[200px] text-center">
          {formatMonthYear(selectedMonth)}
        </div>
        <button
          type="button"
          onClick={handleNextMonth}
          className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-white"
          title="Next month"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div
        className="table-container dark-theme"
        style={{
          maxHeight: '600px',
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5',
        }}
      >
        <HandsontableWrapper
          key={`schedule-${entries.length}`}
          data={getScheduleHandsontableData()}
          columns={scheduleColumns}
          colHeaders={COLUMN_TITLES}
          rowHeaders={true}
          width="100%"
          height={600}
          afterChange={handleScheduleChange}
          onContextMenu={handleScheduleContextMenu}
          enableFormula={false}
          readOnly={false}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom"
        />
      </div>
    </div>
  )
}
