import { getApiBase, getAuthToken } from '@/lib/invoiceApi'

/** Which clinic sheet produced a save-audit event. Must stay in sync with the server allowlist
 *  on POST /api/record-save-audit and the Save Audit Log sheet-kind filter. */
export type SaveAuditSheetKind =
  | 'provider_sheet'
  | 'patients'
  | 'accounts_receivable'
  | 'billing_todo'
  | 'provider_pay'

export type RecordSaveAuditInput = {
  sheetKind: SaveAuditSheetKind
  clinicId: string
  /** Required for provider_sheet / provider_pay; omit for patients / billing_todo. */
  providerId?: string | null
  sheetId?: string | null
  selectedMonthKey?: string | null
  source?: string | null
  rowCount: number
  elapsedMs?: number | null
  success: boolean
  errorMessage?: string | null
  actions?: Record<string, unknown>
  correlationId?: string | null
}

/**
 * Best-effort structural audit for non-provider sheet saves (Patients, AR, Billing To-Do,
 * Provider Pay). Provider sheet saves are audited inside `/api/save-provider-sheet-rows` already.
 *
 * Never throws to callers — audit must not break the user save. PHI-free payload only.
 */
export async function recordSaveAudit(input: RecordSaveAuditInput): Promise<void> {
  try {
    const token = getAuthToken()
    if (!token || !input.clinicId) return
    const base = getApiBase()
    const res = await fetch(`${base}/api/record-save-audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sheet_kind: input.sheetKind,
        clinic_id: input.clinicId,
        provider_id: input.providerId ?? null,
        sheet_id: input.sheetId ?? null,
        selected_month_key: input.selectedMonthKey ?? null,
        source: input.source ?? null,
        row_count: input.rowCount,
        elapsed_ms: input.elapsedMs ?? null,
        success: input.success,
        error_message: input.errorMessage ?? null,
        actions: input.actions ?? {},
        correlation_id: input.correlationId ?? null,
      }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      console.warn(
        '[recordSaveAudit] failed:',
        typeof payload?.error === 'string' ? payload.error : res.status,
      )
    }
  } catch (err) {
    console.warn('[recordSaveAudit] error:', err)
  }
}
