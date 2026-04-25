import type { NativeClient } from '@/lib/nativeClient'
import type { SheetRow } from '@/types'

/** Co-patient IDs (rows in `patients`) + private ID claims (first provider in clinic to use a non-co-patient ID). */
export type PatientAssignmentState = {
  coPatientIdKeys: Set<string>
  privateClaimByPatientIdKey: Map<string, string>
}

/** Prevents double alerts when the grid rejects an ID and the debounced save validates the same ID moments later. */
const WRONG_PROVIDER_ALERT_DEDUPE_MS = 4000
let wrongProviderAlertLastKey = ''
let wrongProviderAlertLastAt = 0

export function normalizePatientIdKey(patientId: string): string {
  return String(patientId ?? '').trim().toLowerCase()
}

export function alertPatientIdWrongProviderDeduped(patientIdDisplay: string): void {
  const key = normalizePatientIdKey(patientIdDisplay)
  if (!key) return
  const t = Date.now()
  if (key === wrongProviderAlertLastKey && t - wrongProviderAlertLastAt < WRONG_PROVIDER_ALERT_DEDUPE_MS) return
  wrongProviderAlertLastKey = key
  wrongProviderAlertLastAt = t
  alert(
    `Patient ID "${patientIdDisplay}" is already assigned to another provider in this clinic. They cannot be added to this provider's sheet.`
  )
}

export async function loadPatientAssignmentState(
  db: NativeClient,
  clinicId: string
): Promise<PatientAssignmentState> {
  const [patientsRes, claimsRes] = await Promise.all([
    db.from('patients').select('patient_id').eq('clinic_id', clinicId),
    db.from('private_patient_claims').select('patient_id, provider_id').eq('clinic_id', clinicId),
  ])
  if (patientsRes.error) throw patientsRes.error
  if (claimsRes.error) throw claimsRes.error

  const coPatientIdKeys = new Set<string>()
  for (const p of patientsRes.data || []) {
    const k = normalizePatientIdKey(String(p.patient_id ?? ''))
    if (k) coPatientIdKeys.add(k)
  }
  const privateClaimByPatientIdKey = new Map<string, string>()
  for (const c of claimsRes.data || []) {
    const k = normalizePatientIdKey(String(c.patient_id ?? ''))
    if (k) privateClaimByPatientIdKey.set(k, String(c.provider_id))
  }
  return { coPatientIdKeys, privateClaimByPatientIdKey }
}

/** Returns whether this patient_id may appear on the given provider's sheet (co-patient or own private claim). */
export function isPatientIdAllowedForProviderSheet(
  patientIdDisplay: string,
  sheetProviderId: string,
  state: PatientAssignmentState
): boolean {
  const key = normalizePatientIdKey(patientIdDisplay)
  if (!key) return true
  if (state.coPatientIdKeys.has(key)) return true
  const owner = state.privateClaimByPatientIdKey.get(key)
  if (!owner) return true
  return owner === sheetProviderId
}

export function validatePatientIdsForProviderSheet(
  rows: SheetRow[],
  sheetProviderId: string,
  state: PatientAssignmentState
): { ok: true } | { ok: false; conflictingPatientId: string } {
  const checked = new Set<string>()
  for (const row of rows) {
    const pid =
      row.patient_id != null && String(row.patient_id).trim() !== '' ? String(row.patient_id).trim() : ''
    if (!pid) continue
    const key = normalizePatientIdKey(pid)
    if (checked.has(key)) continue
    checked.add(key)

    if (state.coPatientIdKeys.has(key)) continue
    const owner = state.privateClaimByPatientIdKey.get(key)
    if (owner && owner !== sheetProviderId) {
      return {
        ok: false,
        conflictingPatientId: pid,
      }
    }
  }
  return { ok: true }
}

/**
 * For each patient_id on the sheet that is not a co-patient, insert a private claim if none exists yet.
 * Mutates `state.privateClaimByPatientIdKey` on success so callers stay in sync.
 */
export async function claimPrivatePatientIdsForProvider(
  db: NativeClient,
  clinicId: string,
  sheetProviderId: string,
  rows: SheetRow[],
  state: PatientAssignmentState
): Promise<void> {
  const keys = new Set<string>()
  const keyToDisplayPid = new Map<string, string>()
  for (const row of rows) {
    const pid =
      row.patient_id != null && String(row.patient_id).trim() !== '' ? String(row.patient_id).trim() : ''
    if (!pid) continue
    const key = normalizePatientIdKey(pid)
    keys.add(key)
    if (!keyToDisplayPid.has(key)) keyToDisplayPid.set(key, pid)
  }

  for (const key of keys) {
    if (state.coPatientIdKeys.has(key)) continue
    const existing = state.privateClaimByPatientIdKey.get(key)
    if (existing === sheetProviderId) continue
    if (existing && existing !== sheetProviderId) {
      console.error('[claimPrivatePatientIdsForProvider] unexpected foreign claim after validation', { key, existing })
      continue
    }

    const displayPid = keyToDisplayPid.get(key) ?? key

    const { error } = await db.from('private_patient_claims').insert({
      clinic_id: clinicId,
      patient_id: displayPid,
      provider_id: sheetProviderId,
    })

    if (!error) {
      state.privateClaimByPatientIdKey.set(key, sheetProviderId)
      continue
    }

    if (error.code === '23505') {
      const { data: claims, error: fetchErr } = await db
        .from('private_patient_claims')
        .select('patient_id, provider_id')
        .eq('clinic_id', clinicId)
      if (fetchErr) {
        console.error('[claimPrivatePatientIdsForProvider] refetch after conflict', fetchErr)
        continue
      }
      const row = (claims || []).find((c) => normalizePatientIdKey(String(c.patient_id ?? '')) === key)
      if (row && String(row.provider_id) === sheetProviderId) {
        state.privateClaimByPatientIdKey.set(key, sheetProviderId)
      } else if (row) {
        console.error('[claimPrivatePatientIdsForProvider] lost race to another provider', { key, row })
      }
      continue
    }

    console.error('[claimPrivatePatientIdsForProvider]', error)
  }
}
