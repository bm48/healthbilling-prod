import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { apiClient } from '@/lib/apiClient'
import { getApiBase, getAuthToken } from '@/lib/invoiceApi'

/** Minimal shapes for the dropdown lookups. Full Clinic/Provider/ProviderSheet types live in
 *  @/types; we only pull the fields the dropdowns need. */
interface ClinicOption {
  id: string
  name: string
}
interface ProviderOption {
  id: string
  first_name: string
  last_name: string
  clinic_ids: string[] | null
  active: boolean | null
}
interface SheetOption {
  id: string
  clinic_id: string
  provider_id: string
  month: number
  year: number
  payroll: number | null
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Build the `selected_month_key` string that the server-side audit column uses (see
 *  buildMonthKey in client/src/lib/providerSheetRows.ts). Match its convention exactly:
 *  `${year}-${month}` for payroll 1, `${year}-${month}-2` for payroll 2. */
function buildMonthKeyForSheet(s: SheetOption): string {
  return Number(s.payroll) === 2 ? `${s.year}-${s.month}-2` : `${s.year}-${s.month}`
}

/** Display label for a sheet in the dropdown, e.g. "Jul 2026" or "Jul 2026 (biweekly ½)". */
function labelForSheet(s: SheetOption): string {
  const base = `${MONTH_ABBR[s.month - 1] ?? s.month} ${s.year}`
  return Number(s.payroll) === 2 ? `${base} (biweekly ½)` : base
}

/**
 * Super-admin viewer for `provider_sheet_save_audit`.
 *
 * Powers post-incident investigation for duplicate/stray-row reports. Each row here corresponds
 * to one POST /api/save-provider-sheet-rows. When a report comes in, we:
 *   1. Filter to the clinic + provider + month the report is about.
 *   2. Look for two rows for the same sheet_id within a short window → race candidate.
 *   3. Expand the row and read `actions` to see whether the loop UPDATE'd, INSERT'd, or
 *      dedupe-collapsed each incoming payload row.
 *
 * PHI note: this page never displays patient names, insurance, or free text. Only structural
 * identifiers (UUIDs, counts, timing, source labels, action summaries).
 */

interface AuditRow {
  id: string
  created_at: string
  correlation_id: string | null
  user_id: string
  user_email: string | null
  clinic_id: string
  provider_id: string
  sheet_id: string | null
  selected_month_key: string
  source: string | null
  row_count: number | null
  lock_wait_ms: number | null
  elapsed_ms: number | null
  success: boolean
  error_message: string | null
  actions: Record<string, unknown>
}

interface Filters {
  clinicId: string
  providerId: string
  sheetId: string
  correlationId: string
  selectedMonthKey: string
  source: string
  fromTs: string
  toTs: string
  onlyWithInserts: boolean
}

const EMPTY_FILTERS: Filters = {
  clinicId: '',
  providerId: '',
  sheetId: '',
  correlationId: '',
  selectedMonthKey: '',
  source: '',
  fromTs: '',
  toTs: '',
  onlyWithInserts: false,
}

// The list of sources the client actually sends. Kept in sync with the `source: '...'` literals
// passed to saveProviderSheetRows / saveSheetRows / the pagehide fetch body in ClinicDetail.tsx.
// If you add a new call site with a new source label, add it here too so the dropdown surfaces it.
const KNOWN_SOURCES = [
  'typing-debounced-or-direct',
  'pagehide-keepalive',
  'deferred-drain-queued',
  'deferred-replay',
  'auto-backup-restore',
  'auto-backup-restore-undo',
  'localstorage-restore-on-mount',
  'delete-rows',
  'undo-delete-rows',
  'add-row',
  'reorder-rows',
  'sync-provider-rows-fromLegacyState',
  'provider-sheet-page',
  'month-close-provider-pay-distribution',
  'unknown',
] as const

function shortId(id: string | null | undefined): string {
  if (!id) return ''
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Build the query string. Only appends non-empty values so the endpoint's `strParam` treats
 *  empty inputs as "no filter" instead of "match empty string." */
function buildQueryString(filters: Filters, limit: number): string {
  const params = new URLSearchParams()
  if (filters.clinicId.trim()) params.set('clinic_id', filters.clinicId.trim())
  if (filters.providerId.trim()) params.set('provider_id', filters.providerId.trim())
  if (filters.sheetId.trim()) params.set('sheet_id', filters.sheetId.trim())
  if (filters.correlationId.trim()) params.set('correlation_id', filters.correlationId.trim())
  if (filters.selectedMonthKey.trim()) params.set('selected_month_key', filters.selectedMonthKey.trim())
  if (filters.source.trim()) params.set('source', filters.source.trim())
  if (filters.fromTs.trim()) params.set('from_ts', new Date(filters.fromTs).toISOString())
  if (filters.toTs.trim()) params.set('to_ts', new Date(filters.toTs).toISOString())
  if (filters.onlyWithInserts) params.set('only_with_inserts', 'true')
  params.set('limit', String(limit))
  return params.toString()
}

export default function SaveAuditLog() {
  const { userProfile, loading: authLoading } = useAuth()
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [limit, setLimit] = useState<number>(200)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dropdown lookups. Fetched once for clinics + providers (super-admin sees everything), and on
  // demand for sheets whenever the user picks a clinic + provider pair. Keeping these in
  // component state (rather than a shared cache) is fine — this page opens rarely, always by
  // the same super-admin, and the lists change infrequently.
  const [clinics, setClinics] = useState<ClinicOption[]>([])
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [sheets, setSheets] = useState<SheetOption[]>([])
  const [lookupsError, setLookupsError] = useState<string | null>(null)

  // One-shot: clinics + providers on mount. Sheets are a separate effect keyed to selected
  // clinic+provider so we don't pull the full sheet list up front.
  useEffect(() => {
    if (userProfile?.role !== 'super_admin') return
    let cancelled = false
    void (async () => {
      try {
        const [clinicsRes, providersRes] = await Promise.all([
          apiClient.from('clinics').select('id, name').order('name'),
          apiClient.from('providers').select('id, first_name, last_name, clinic_ids, active'),
        ])
        if (cancelled) return
        if (clinicsRes.error) throw clinicsRes.error
        if (providersRes.error) throw providersRes.error
        setClinics((clinicsRes.data ?? []) as ClinicOption[])
        // Sort providers by last name then first — dropdown scan order should match how users
        // think about the roster. Filter out inactive so the list stays short.
        const active = ((providersRes.data ?? []) as ProviderOption[])
          .filter((p) => p.active !== false)
          .sort((a, b) => {
            const ln = (a.last_name ?? '').localeCompare(b.last_name ?? '')
            if (ln !== 0) return ln
            return (a.first_name ?? '').localeCompare(b.first_name ?? '')
          })
        setProviders(active)
      } catch (err) {
        if (cancelled) return
        setLookupsError(err instanceof Error ? err.message : 'Failed to load clinics/providers')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userProfile])

  // Sheets refetch when clinic+provider selection changes. Skips if either half is missing.
  useEffect(() => {
    if (!filters.clinicId || !filters.providerId) {
      setSheets([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { data, error: sheetsErr } = await apiClient
          .from('provider_sheets')
          .select('id, clinic_id, provider_id, month, year, payroll')
          .eq('clinic_id', filters.clinicId)
          .eq('provider_id', filters.providerId)
          .order('year', { ascending: false })
          .order('month', { ascending: false })
          .order('payroll', { ascending: true })
        if (cancelled) return
        if (sheetsErr) throw sheetsErr
        setSheets((data ?? []) as SheetOption[])
      } catch (err) {
        if (cancelled) return
        setSheets([])
        setLookupsError(err instanceof Error ? err.message : 'Failed to load sheets')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filters.clinicId, filters.providerId])

  // Providers filtered by the currently-selected clinic. If no clinic is picked we show every
  // provider — that's useful for correlation-ID / source-only investigations where the user
  // doesn't remember which clinic they belong to.
  const providersForClinic = useMemo(() => {
    if (!filters.clinicId) return providers
    return providers.filter((p) => (p.clinic_ids ?? []).includes(filters.clinicId))
  }, [providers, filters.clinicId])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = getAuthToken()
      if (!token) throw new Error('Not signed in')
      const qs = buildQueryString(filters, limit)
      const base = getApiBase()
      const res = await fetch(`${base}/api/super-admin/save-audit-logs?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `Load failed (${res.status})`)
      }
      setRows(Array.isArray(payload?.rows) ? (payload.rows as AuditRow[]) : [])
      setExpandedIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit rows')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [filters, limit])

  /** Wipe every audit row. Guarded by a browser confirm() so a stray click can't destroy the
   *  entire debug history. On success, refetches (which will render "no rows match"). */
  const deleteAllLogs = useCallback(async () => {
    const confirmed = typeof window !== 'undefined' && window.confirm(
      'Delete ALL save-audit rows across every clinic and provider?\n\n' +
      'This cannot be undone. New saves will continue to be logged afterward.'
    )
    if (!confirmed) return
    setLoading(true)
    setError(null)
    try {
      const token = getAuthToken()
      if (!token) throw new Error('Not signed in')
      const base = getApiBase()
      const res = await fetch(`${base}/api/super-admin/save-audit-logs`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `Delete failed (${res.status})`)
      }
      // Refetch so the table clears and the "no rows match" empty state appears — cheaper than
      // manually zero-ing the local `rows` state and keeps the count/empty-state logic consistent.
      await fetchRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete audit rows')
      setLoading(false)
    }
  }, [fetchRows])

  // Initial load: pull the most recent 200 rows across everything so the page is useful the
  // moment you open it, before filtering to a specific clinic/provider.
  useEffect(() => {
    void fetchRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Group audit rows by (sheet_id, minute-bucket) to visually flag same-sheet saves that landed
  // close together — those are the race candidates that most often produce duplicates. A group
  // of 2+ audit rows means concurrent traffic went through the advisory lock (or slipped past it
  // pre-fix); expand both to compare their action summaries.
  const raceCandidateGroups = useMemo(() => {
    const groups = new Map<string, AuditRow[]>()
    for (const r of rows) {
      if (!r.sheet_id) continue
      // 60-second bucket. Coarse enough to catch debounce + pagehide overlaps (which typically
      // happen within a few seconds of each other) without lumping unrelated traffic together.
      const bucket = Math.floor(new Date(r.created_at).getTime() / 60_000)
      const key = `${r.sheet_id}:${bucket}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }
    return new Set(
      [...groups.entries()]
        .filter(([, arr]) => arr.length > 1)
        .flatMap(([, arr]) => arr.map((r) => r.id)),
    )
  }, [rows])

  if (authLoading) {
    return <div className="p-6 text-gray-600">Loading…</div>
  }
  if (userProfile?.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Save audit log</h1>
        <p className="text-sm text-white/70 mt-1">
          One row per POST /api/save-provider-sheet-rows. Rows highlighted amber landed on the
          same sheet within the same minute as at least one other row — those are the race
          candidates worth expanding when investigating a duplicate report.
        </p>
      </div>

      <div className="rounded border border-white/20 bg-slate-900/60 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm text-white/80">
          Clinic
          <select
            value={filters.clinicId}
            // Clearing / changing clinic wipes provider + sheet + month-key so we don't leave
            // stale downstream selections that don't match the new clinic's roster.
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                clinicId: e.target.value,
                providerId: '',
                sheetId: '',
                selectedMonthKey: '',
              }))
            }
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          >
            <option value="" style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>(any clinic)</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id} style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-white/80">
          Provider
          <select
            value={filters.providerId}
            // Changing provider wipes sheet + month-key for the same reason clinic does.
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                providerId: e.target.value,
                sheetId: '',
                selectedMonthKey: '',
              }))
            }
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          >
            <option value="" style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>(any provider)</option>
            {providersForClinic.map((p) => (
              <option key={p.id} value={p.id} style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-white/80">
          Sheet
          <select
            value={filters.sheetId}
            // Selecting a sheet auto-populates selected_month_key so the two filters stay in
            // sync — the audit endpoint honors both, and mismatched values would return zero
            // rows in a way that looks like "the query is broken" rather than "the filter is
            // over-constrained."
            onChange={(e) => {
              const selectedId = e.target.value
              const matched = sheets.find((s) => s.id === selectedId)
              setFilters((f) => ({
                ...f,
                sheetId: selectedId,
                selectedMonthKey: matched ? buildMonthKeyForSheet(matched) : '',
              }))
            }}
            disabled={!filters.clinicId || !filters.providerId}
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm disabled:opacity-50"
          >
            <option value="" style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
              {filters.clinicId && filters.providerId ? '(any sheet)' : '(pick clinic + provider first)'}
            </option>
            {sheets.map((s) => (
              <option key={s.id} value={s.id} style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
                {labelForSheet(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-white/80">
          Selected month key
          <input
            type="text"
            value={filters.selectedMonthKey}
            onChange={(e) => setFilters((f) => ({ ...f, selectedMonthKey: e.target.value }))}
            placeholder="e.g. 2026-7 or 2026-7-2"
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          />
        </label>
        <label className="text-sm text-white/80">
          Correlation ID
          <input
            type="text"
            value={filters.correlationId}
            onChange={(e) => setFilters((f) => ({ ...f, correlationId: e.target.value }))}
            placeholder="jump to a single event"
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          />
        </label>
        <label className="text-sm text-white/80">
          Source
          <select
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          >
            <option value="">(any)</option>
            {KNOWN_SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-white/80">
          From
          <input
            type="datetime-local"
            value={filters.fromTs}
            onChange={(e) => setFilters((f) => ({ ...f, fromTs: e.target.value }))}
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          />
        </label>
        <label className="text-sm text-white/80">
          To
          <input
            type="datetime-local"
            value={filters.toTs}
            onChange={(e) => setFilters((f) => ({ ...f, toTs: e.target.value }))}
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          />
        </label>
        <label className="text-sm text-white/80">
          Limit
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 200)))}
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-white/80 md:col-span-2 mt-2">
          <input
            type="checkbox"
            checked={filters.onlyWithInserts}
            onChange={(e) => setFilters((f) => ({ ...f, onlyWithInserts: e.target.checked }))}
          />
          Only show saves that INSERTed at least one row
        </label>
        <div className="md:col-span-1 flex items-end justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="px-3 py-1.5 rounded border border-white/20 text-white/80 text-sm hover:bg-white/10"
          >
            Clear
          </button>
          {/* Destructive button. Kept visually distinct from Refresh/Clear (red border + text)
              so a stray click reads as "danger" before you commit. The confirm() dialog inside
              deleteAllLogs is the actual safety net. */}
          <button
            type="button"
            onClick={() => void deleteAllLogs()}
            disabled={loading}
            className="px-3 py-1.5 rounded border border-red-400/60 text-red-200 text-sm hover:bg-red-500/20 disabled:opacity-50"
            title="Delete every audit row across all clinics and providers"
          >
            Delete all logs
          </button>
          <button
            type="button"
            onClick={() => void fetchRows()}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-primary-500/40 border border-primary-400/60 text-white text-sm hover:bg-primary-500/60 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-900/30 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {lookupsError && (
        <div className="rounded border border-amber-500/40 bg-amber-900/30 text-amber-200 px-3 py-2 text-sm">
          Dropdown load failed: {lookupsError}. Filter inputs will be empty; use text-only filters
          (Correlation ID, Selected month key, dates) as a fallback.
        </div>
      )}

      <div className="rounded border border-white/20 overflow-auto" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        <table className="min-w-full text-sm text-white/90">
          <thead className="bg-slate-900 text-white/70 sticky top-0 z-10">
            <tr>
              <th className="px-2 py-1.5 text-left">When</th>
              <th className="px-2 py-1.5 text-left">User</th>
              <th className="px-2 py-1.5 text-left">Source</th>
              <th className="px-2 py-1.5 text-left">Sheet</th>
              <th className="px-2 py-1.5 text-left">Month</th>
              <th className="px-2 py-1.5 text-right">Rows in</th>
              <th className="px-2 py-1.5 text-right">Actions</th>
              <th className="px-2 py-1.5 text-right">Lock</th>
              <th className="px-2 py-1.5 text-right">Elapsed</th>
              <th className="px-2 py-1.5 text-left">Correlation</th>
              <th className="px-2 py-1.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-white/60 italic">
                  No audit rows match. Try clearing filters or widening the date range.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isExpanded = expandedIds.has(r.id)
              const isRaceCandidate = raceCandidateGroups.has(r.id)
              const actions = r.actions as Record<string, unknown>
              const inserts = Number(actions.inserts ?? 0)
              const updates = Number(actions.updates ?? 0)
              const collapses = Number(actions.dedupe_collapses ?? 0)
              const rejects = Number(actions.rejected_patient_less ?? 0)
              const deletes = Number(actions.deletes ?? 0)
              const summary = `U:${updates} I:${inserts} DC:${collapses} RJ:${rejects} D:${deletes}`
              return (
                <>
                  <tr
                    key={r.id}
                    onClick={() => toggleExpanded(r.id)}
                    className={`cursor-pointer border-t border-white/10 hover:bg-white/5 ${
                      isRaceCandidate ? 'bg-amber-500/10' : ''
                    } ${!r.success ? 'bg-red-500/10' : ''}`}
                  >
                    <td className="px-2 py-1 whitespace-nowrap font-mono text-xs">{formatDateTime(r.created_at)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.user_email ?? shortId(r.user_id)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.source ?? '(none)'}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono text-xs" title={r.sheet_id ?? ''}>{shortId(r.sheet_id)}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono text-xs">{r.selected_month_key}</td>
                    <td className="px-2 py-1 text-right">{r.row_count ?? ''}</td>
                    <td className="px-2 py-1 text-right font-mono text-xs">{summary}</td>
                    <td className="px-2 py-1 text-right">{formatMs(r.lock_wait_ms)}</td>
                    <td className="px-2 py-1 text-right">{formatMs(r.elapsed_ms)}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono text-xs" title={r.correlation_id ?? ''}>{shortId(r.correlation_id)}</td>
                    <td className="px-2 py-1">
                      {r.success ? (
                        <span className="text-emerald-400 text-xs">ok</span>
                      ) : (
                        <span className="text-red-300 text-xs">fail</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${r.id}-detail`} className="bg-slate-950/60">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="text-white/60 uppercase tracking-wide mb-1">Identity</div>
                            <div className="font-mono text-white/90 space-y-0.5">
                              <div>audit_id: {r.id}</div>
                              <div>correlation_id: {r.correlation_id ?? '(none)'}</div>
                              <div>user_id: {r.user_id}</div>
                              <div>clinic_id: {r.clinic_id}</div>
                              <div>provider_id: {r.provider_id}</div>
                              <div>sheet_id: {r.sheet_id ?? '(none)'}</div>
                            </div>
                          </div>
                          <div>
                            <div className="text-white/60 uppercase tracking-wide mb-1">Actions</div>
                            <pre className="font-mono text-white/90 whitespace-pre-wrap bg-black/40 p-2 rounded max-h-[300px] overflow-auto">
{JSON.stringify(actions, null, 2)}
                            </pre>
                          </div>
                          {r.error_message && (
                            <div className="md:col-span-2">
                              <div className="text-red-300 uppercase tracking-wide mb-1">Error</div>
                              <pre className="font-mono text-red-200 whitespace-pre-wrap bg-black/40 p-2 rounded">
{r.error_message}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-white/50">
        Showing {rows.length} row{rows.length === 1 ? '' : 's'} (capped at {limit}). Retention: 30
        days. PHI-free — this table stores only UUIDs, counts, timing, and source labels.
      </p>
    </div>
  )
}
