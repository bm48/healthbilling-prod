import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { apiClient } from '@/lib/apiClient'
import { getApiBase, getAuthToken } from '@/lib/invoiceApi'
import { Copy, Check } from 'lucide-react'

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

function buildMonthKeyForSheet(s: SheetOption): string {
  return Number(s.payroll) === 2 ? `${s.year}-${s.month}-2` : `${s.year}-${s.month}`
}

function labelForSheet(s: SheetOption): string {
  const base = `${MONTH_ABBR[s.month - 1] ?? s.month} ${s.year}`
  return Number(s.payroll) === 2 ? `${base} (biweekly ½)` : base
}

/**
 * Super-admin viewer for sheet save audit (`provider_sheet_save_audit`).
 *
 * One row per save batch across provider sheets, patients, AR, billing to-do, and provider pay.
 * PHI-free: UUIDs, counts, timing, source labels, action summaries only.
 */

interface AuditRow {
  id: string
  created_at: string
  sheet_kind: string | null
  correlation_id: string | null
  user_id: string
  user_email: string | null
  clinic_id: string
  provider_id: string | null
  sheet_id: string | null
  selected_month_key: string | null
  source: string | null
  row_count: number | null
  lock_wait_ms: number | null
  elapsed_ms: number | null
  success: boolean
  error_message: string | null
  actions: Record<string, unknown>
}

interface Filters {
  sheetKind: string
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
  sheetKind: '',
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

const SHEET_KINDS = [
  { value: 'provider_sheet', label: 'Provider billing sheet' },
  { value: 'patients', label: 'Patient Info' },
  { value: 'accounts_receivable', label: 'Accounts Receivable' },
  { value: 'billing_todo', label: 'Billing To-Do' },
  { value: 'provider_pay', label: 'Provider Pay' },
] as const

const KNOWN_SOURCES = [
  'typing-debounced-or-direct',
  'row-leave-or-flush',
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
  'provider-pay-save',
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

function sheetKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'provider_sheet'
  return SHEET_KINDS.find((k) => k.value === kind)?.label ?? kind
}

function buildQueryString(filters: Filters, limit: number): string {
  const params = new URLSearchParams()
  if (filters.sheetKind.trim()) params.set('sheet_kind', filters.sheetKind.trim())
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

function actionSummary(actions: Record<string, unknown>): string {
  const inserts = Number(actions.inserts ?? 0)
  const updates = Number(actions.updates ?? 0)
  const collapses = Number(actions.dedupe_collapses ?? 0)
  const rejects = Number(actions.rejected_patient_less ?? 0)
  const deletes = Number(actions.deletes ?? 0)
  if (actions.row_replace) return 'row_replace'
  return `U:${updates} I:${inserts} DC:${collapses} RJ:${rejects} D:${deletes}`
}

function rowToCopyText(r: AuditRow, clinicName?: string, providerName?: string): string {
  return [
    `when: ${formatDateTime(r.created_at)}`,
    `sheet_kind: ${r.sheet_kind ?? 'provider_sheet'}`,
    `success: ${r.success}`,
    `user: ${r.user_email ?? r.user_id}`,
    `clinic: ${clinicName ?? r.clinic_id}`,
    `clinic_id: ${r.clinic_id}`,
    `provider: ${providerName ?? r.provider_id ?? '(none)'}`,
    `provider_id: ${r.provider_id ?? '(none)'}`,
    `sheet_id: ${r.sheet_id ?? '(none)'}`,
    `month: ${r.selected_month_key ?? '(none)'}`,
    `source: ${r.source ?? '(none)'}`,
    `row_count: ${r.row_count ?? ''}`,
    `actions: ${actionSummary(r.actions)}`,
    `lock_wait: ${formatMs(r.lock_wait_ms)}`,
    `elapsed: ${formatMs(r.elapsed_ms)}`,
    `correlation_id: ${r.correlation_id ?? '(none)'}`,
    `audit_id: ${r.id}`,
    r.error_message ? `error: ${r.error_message}` : null,
    `actions_json: ${JSON.stringify(r.actions)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function rowsToTsv(
  rows: AuditRow[],
  clinicNameById?: Map<string, string>,
  providerNameById?: Map<string, string>,
): string {
  const headers = [
    'when',
    'sheet_kind',
    'success',
    'user_email',
    'clinic',
    'clinic_id',
    'provider',
    'provider_id',
    'sheet_id',
    'month',
    'source',
    'row_count',
    'actions',
    'lock_ms',
    'elapsed_ms',
    'correlation_id',
    'audit_id',
    'error',
  ]
  const escape = (v: string) => {
    if (/[\t\n\r"]/.test(v)) return `"${v.replace(/"/g, '""')}"`
    return v
  }
  const lines = [
    headers.join('\t'),
    ...rows.map((r) =>
      [
        formatDateTime(r.created_at),
        r.sheet_kind ?? 'provider_sheet',
        String(r.success),
        r.user_email ?? r.user_id,
        clinicNameById?.get(r.clinic_id) ?? '',
        r.clinic_id,
        r.provider_id ? (providerNameById?.get(r.provider_id) ?? '') : '',
        r.provider_id ?? '',
        r.sheet_id ?? '',
        r.selected_month_key ?? '',
        r.source ?? '',
        String(r.row_count ?? ''),
        actionSummary(r.actions),
        String(r.lock_wait_ms ?? ''),
        String(r.elapsed_ms ?? ''),
        r.correlation_id ?? '',
        r.id,
        r.error_message ?? '',
      ]
        .map((c) => escape(String(c)))
        .join('\t'),
    ),
  ]
  return lines.join('\n')
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function CopyButton({
  label,
  getText,
  className = '',
  disabled = false,
}: {
  label: string
  getText: () => string | Promise<string>
  className?: string
  disabled?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      title={label}
      disabled={disabled || busy}
      onClick={async (e) => {
        e.stopPropagation()
        if (disabled || busy) return
        setBusy(true)
        try {
          const text = await getText()
          if (!text) return
          const ok = await copyText(text)
          if (ok) {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }
        } finally {
          setBusy(false)
        }
      }}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs disabled:opacity-50 disabled:pointer-events-none ${
        copied
          ? 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10'
          : 'border-white/20 text-white/80 hover:bg-white/10'
      } ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {busy ? 'Copying…' : copied ? 'Copied' : label}
    </button>
  )
}

export default function SaveAuditLog() {
  const { userProfile, loading: authLoading } = useAuth()
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [limit, setLimit] = useState<number>(200)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clinics, setClinics] = useState<ClinicOption[]>([])
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [sheets, setSheets] = useState<SheetOption[]>([])
  const [lookupsError, setLookupsError] = useState<string | null>(null)

  const showProviderSheetFilters =
    !filters.sheetKind || filters.sheetKind === 'provider_sheet' || filters.sheetKind === 'provider_pay'

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

  useEffect(() => {
    if (!filters.clinicId || !filters.providerId || !showProviderSheetFilters) {
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
  }, [filters.clinicId, filters.providerId, showProviderSheetFilters])

  const providersForClinic = useMemo(() => {
    if (!filters.clinicId) return providers
    return providers.filter((p) => (p.clinic_ids ?? []).includes(filters.clinicId))
  }, [providers, filters.clinicId])

  const clinicNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of clinics) m.set(c.id, c.name)
    return m
  }, [clinics])

  const providerNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of providers) m.set(p.id, `${p.first_name} ${p.last_name}`.trim())
    return m
  }, [providers])

  const fetchRows = useCallback(async (): Promise<AuditRow[]> => {
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
      const next = Array.isArray(payload?.rows) ? (payload.rows as AuditRow[]) : []
      setRows(next)
      setExpandedIds(new Set())
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit rows')
      setRows([])
      return []
    } finally {
      setLoading(false)
    }
  }, [filters, limit])

  /** Re-applies the current filters, then copies every returned row as TSV (paste into Excel/Sheets). */
  const copyFilteredResults = useCallback(async () => {
    const next = await fetchRows()
    return rowsToTsv(next, clinicNameById, providerNameById)
  }, [fetchRows, clinicNameById, providerNameById])

  const deleteAllLogs = useCallback(async () => {
    const confirmed =
      typeof window !== 'undefined' &&
      window.confirm(
        'Delete ALL save-audit rows across every clinic and sheet?\n\n' +
          'This cannot be undone. New saves will continue to be logged afterward.',
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
      await fetchRows()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete audit rows')
      setLoading(false)
    }
  }, [fetchRows])

  useEffect(() => {
    void fetchRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const raceCandidateGroups = useMemo(() => {
    const groups = new Map<string, AuditRow[]>()
    for (const r of rows) {
      if (!r.sheet_id) continue
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Save audit log</h1>
          <p className="text-sm text-white/70 mt-1 max-w-3xl">
            One row per save batch across provider billing sheets, Patient Info, Accounts Receivable,
            Billing To-Do, and Provider Pay. Amber rows are same-sheet races within a minute.
            Filter, then use <span className="text-white/90">Copy filtered results</span> to copy
            every matching row (TSV — pastes into Excel / Sheets / Slack).
          </p>
        </div>
      </div>

      <div className="rounded border border-white/20 bg-slate-900/60 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm text-white/80">
          Sheet type
          <select
            value={filters.sheetKind}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                sheetKind: e.target.value,
                ...(e.target.value && e.target.value !== 'provider_sheet' && e.target.value !== 'provider_pay'
                  ? { sheetId: '', selectedMonthKey: '', providerId: e.target.value === 'patients' || e.target.value === 'billing_todo' || e.target.value === 'accounts_receivable' ? f.providerId : f.providerId }
                  : {}),
              }))
            }
            className="mt-1 w-full px-2 py-1 rounded border border-white/20 bg-slate-800/80 text-white text-sm"
          >
            <option value="">(any sheet type)</option>
            {SHEET_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-white/80">
          Clinic
          <select
            value={filters.clinicId}
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
            <option value="">(any clinic)</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {showProviderSheetFilters && (
          <label className="text-sm text-white/80">
            Provider
            <select
              value={filters.providerId}
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
              <option value="">(any provider)</option>
              {providersForClinic.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                </option>
              ))}
            </select>
          </label>
        )}
        {filters.sheetKind === 'provider_sheet' || !filters.sheetKind ? (
          <label className="text-sm text-white/80">
            Sheet
            <select
              value={filters.sheetId}
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
              <option value="">
                {filters.clinicId && filters.providerId ? '(any sheet)' : '(pick clinic + provider first)'}
              </option>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {labelForSheet(s)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
              <option key={s} value={s}>
                {s}
              </option>
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
        <div className="md:col-span-1 flex flex-wrap items-end justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="px-3 py-1.5 rounded border border-white/20 text-white/80 text-sm hover:bg-white/10"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => void deleteAllLogs()}
            disabled={loading}
            className="px-3 py-1.5 rounded border border-red-400/60 text-red-200 text-sm hover:bg-red-500/20 disabled:opacity-50"
            title="Delete every audit row across all clinics and sheets"
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
          <CopyButton
            label={rows.length ? `Copy filtered results (${rows.length})` : 'Copy filtered results'}
            getText={copyFilteredResults}
            disabled={loading}
            className="!px-3 !py-1.5 !text-sm bg-white/10"
          />
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-900/30 text-red-200 px-3 py-2 text-sm">{error}</div>
      )}
      {lookupsError && (
        <div className="rounded border border-amber-500/40 bg-amber-900/30 text-amber-200 px-3 py-2 text-sm">
          Dropdown load failed: {lookupsError}. Use text filters as a fallback.
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-white/70">
          {loading ? 'Loading…' : `${rows.length} filtered row${rows.length === 1 ? '' : 's'}`}
          {rows.length >= limit ? ` (capped at ${limit})` : ''}
        </p>
        <CopyButton
          label={rows.length ? `Copy filtered results (${rows.length} rows)` : 'Copy filtered results'}
          getText={copyFilteredResults}
          disabled={loading}
          className="!px-3 !py-1.5 !text-sm bg-white/10"
        />
      </div>

      <div className="rounded border border-white/20 overflow-auto" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        <table className="min-w-full text-sm text-white/90">
          <thead className="bg-slate-900 text-white/70 sticky top-0 z-10">
            <tr>
              <th className="px-2 py-1.5 text-left">When</th>
              <th className="px-2 py-1.5 text-left">Type</th>
              <th className="px-2 py-1.5 text-left">User</th>
              <th className="px-2 py-1.5 text-left">Source</th>
              <th className="px-2 py-1.5 text-left">Clinic</th>
              <th className="px-2 py-1.5 text-left">Sheet / month</th>
              <th className="px-2 py-1.5 text-right">Rows</th>
              <th className="px-2 py-1.5 text-right">Actions</th>
              <th className="px-2 py-1.5 text-right">Elapsed</th>
              <th className="px-2 py-1.5 text-left">Correlation</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Copy</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-white/60 italic">
                  No audit rows match. Try clearing filters or widening the date range.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isExpanded = expandedIds.has(r.id)
              const isRaceCandidate = raceCandidateGroups.has(r.id)
              const actions = r.actions as Record<string, unknown>
              const clinicLabel = clinicNameById.get(r.clinic_id) ?? shortId(r.clinic_id)
              const providerLabel = r.provider_id
                ? providerNameById.get(r.provider_id) ?? shortId(r.provider_id)
                : ''
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => toggleExpanded(r.id)}
                    className={`cursor-pointer border-t border-white/10 hover:bg-white/5 ${
                      isRaceCandidate ? 'bg-amber-500/10' : ''
                    } ${!r.success ? 'bg-red-500/10' : ''}`}
                  >
                    <td className="px-2 py-1 whitespace-nowrap font-mono text-xs">{formatDateTime(r.created_at)}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-xs">{sheetKindLabel(r.sheet_kind)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.user_email ?? shortId(r.user_id)}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-xs">{r.source ?? '(none)'}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-xs" title={r.clinic_id}>
                      {clinicLabel}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono text-xs" title={r.sheet_id ?? ''}>
                      {r.selected_month_key || shortId(r.sheet_id) || providerLabel || '—'}
                    </td>
                    <td className="px-2 py-1 text-right">{r.row_count ?? ''}</td>
                    <td className="px-2 py-1 text-right font-mono text-xs">{actionSummary(actions)}</td>
                    <td className="px-2 py-1 text-right">{formatMs(r.elapsed_ms)}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono text-xs" title={r.correlation_id ?? ''}>
                      {shortId(r.correlation_id)}
                    </td>
                    <td className="px-2 py-1">
                      {r.success ? (
                        <span className="text-emerald-400 text-xs">ok</span>
                      ) : (
                        <span className="text-red-300 text-xs">fail</span>
                      )}
                    </td>
                    <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <CopyButton
                        label="Copy"
                        getText={() =>
                          rowToCopyText(
                            r,
                            clinicNameById.get(r.clinic_id),
                            r.provider_id ? providerNameById.get(r.provider_id) : undefined,
                          )
                        }
                      />
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-950/60">
                      <td colSpan={12} className="px-4 py-3">
                        <div className="flex flex-wrap gap-2 mb-3">
                          <CopyButton
                            label="Copy row"
                            getText={() =>
                              rowToCopyText(
                                r,
                                clinicNameById.get(r.clinic_id),
                                r.provider_id ? providerNameById.get(r.provider_id) : undefined,
                              )
                            }
                          />
                          <CopyButton
                            label="Copy correlation ID"
                            getText={() => r.correlation_id ?? ''}
                          />
                          <CopyButton label="Copy audit ID" getText={() => r.id} />
                          <CopyButton
                            label="Copy actions JSON"
                            getText={() => JSON.stringify(actions, null, 2)}
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="text-white/60 uppercase tracking-wide mb-1">Identity</div>
                            <div className="font-mono text-white/90 space-y-0.5 select-text">
                              <div>sheet_kind: {r.sheet_kind ?? 'provider_sheet'}</div>
                              <div>audit_id: {r.id}</div>
                              <div>correlation_id: {r.correlation_id ?? '(none)'}</div>
                              <div>user_id: {r.user_id}</div>
                              <div>clinic_id: {r.clinic_id}</div>
                              <div>provider_id: {r.provider_id ?? '(none)'}</div>
                              <div>sheet_id: {r.sheet_id ?? '(none)'}</div>
                            </div>
                          </div>
                          <div>
                            <div className="text-white/60 uppercase tracking-wide mb-1">Actions</div>
                            <pre className="font-mono text-white/90 whitespace-pre-wrap bg-black/40 p-2 rounded max-h-[300px] overflow-auto select-text">
{JSON.stringify(actions, null, 2)}
                            </pre>
                          </div>
                          {r.error_message && (
                            <div className="md:col-span-2">
                              <div className="text-red-300 uppercase tracking-wide mb-1">Error</div>
                              <pre className="font-mono text-red-200 whitespace-pre-wrap bg-black/40 p-2 rounded select-text">
{r.error_message}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-white/50">
        Showing {rows.length} row{rows.length === 1 ? '' : 's'} (capped at {limit}). Copy filtered
        results copies every currently loaded row as TSV. Retention: 30 days. PHI-free — UUIDs,
        counts, timing, and source labels only. Requires DB migration
        `20260811_sheet_save_audit_all_kinds.sql` for sheet_kind on existing databases.
      </p>
    </div>
  )
}
