import type { AuthUser } from './auth.js'

const PRIVILEGED = new Set(['super_admin', 'admin', 'view_only_admin'])

const TABLES_WITH_CLINIC_ID = new Set([
  'accounts_receivables',
  'ar_backups',
  'audit_logs',
  'cell_comments',
  'cell_highlights',
  'clinic_addresses',
  'clinic_invoice_notes',
  'invoices',
  'is_lock_accounts_receivable',
  'is_lock_billing_todo',
  'is_lock_patients',
  'is_lock_providers',
  'patients',
  'patients_backups',
  'private_patient_claims',
  'provider_pay',
  'provider_pay_backups',
  'provider_schedules',
  'provider_sheets',
  'timecards',
  'todo_lists',
])

export function isPrivilegedAdmin(authUser: AuthUser): boolean {
  return PRIVILEGED.has(authUser.role)
}

export function assertCanMutateReferenceData(
  table: string,
  action: string,
  authUser: AuthUser,
): string | null {
  if (!['insert', 'update', 'delete', 'upsert'].includes(action)) return null
  if (['billing_codes', 'status_colors'].includes(table) && authUser.role !== 'super_admin') {
    return 'Only super_admin can modify billing codes or status colors.'
  }
  if (table === 'invite_tokens' && authUser.role !== 'super_admin') {
    return 'Only super_admin can modify invite tokens.'
  }
  return null
}

/**
 * Appends AND … using new parameters pushed onto `params` (after caller's filter params).
 */
export function appendRowLevelSecurity(table: string, authUser: AuthUser, params: unknown[]): string {
  if (table === 'invite_tokens' && authUser.role !== 'super_admin') {
    return ' AND false'
  }

  if (isPrivilegedAdmin(authUser)) return ''

  if (table === 'notifications') {
    params.push(authUser.id)
    return ` AND user_id = $${params.length}::uuid`
  }

  const clinics = authUser.clinic_ids ?? []
  if (clinics.length === 0) return ' AND false'

  switch (table) {
    case 'clinics': {
      params.push(clinics)
      return ` AND id = ANY($${params.length}::uuid[])`
    }
    case 'providers': {
      params.push(clinics)
      return ` AND clinic_ids && $${params.length}::uuid[]`
    }
    case 'provider_sheet_rows': {
      params.push(clinics)
      return ` AND sheet_id IN (SELECT id FROM public.provider_sheets WHERE clinic_id = ANY($${params.length}::uuid[]))`
    }
    case 'provider_pay_rows': {
      params.push(clinics)
      return ` AND provider_pay_id IN (SELECT id FROM public.provider_pay WHERE clinic_id = ANY($${params.length}::uuid[]))`
    }
    case 'provider_sheet_backups': {
      params.push(clinics)
      return ` AND sheet_id IN (SELECT id FROM public.provider_sheets WHERE clinic_id = ANY($${params.length}::uuid[]))`
    }
    case 'provider_logins': {
      params.push(clinics)
      return ` AND provider_id IN (SELECT id FROM public.providers WHERE clinic_ids && $${params.length}::uuid[])`
    }
    case 'column_locks': {
      params.push(clinics)
      const n = params.length
      return ` AND (
        clinic_id = ANY($${n}::uuid[])
        OR provider_id IN (SELECT id FROM public.providers WHERE clinic_ids && $${n}::uuid[])
      )`
    }
    default:
      if (TABLES_WITH_CLINIC_ID.has(table)) {
        params.push(clinics)
        return ` AND clinic_id = ANY($${params.length}::uuid[])`
      }
      return ''
  }
}
