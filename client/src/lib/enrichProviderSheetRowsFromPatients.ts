import type { Patient, SheetRow } from '@/types'

function isEmptyPatientCell(val: unknown): boolean {
  if (val == null) return true
  const s = String(val).trim()
  return s === '' || s.toLowerCase() === 'null'
}

/**
 * When provider_sheet_rows has patient_id but empty denormalized patient fields, copy from patients table
 * (same clinic + patient_id). Only fills fields that are empty on the row so explicit sheet values win.
 */
export function enrichSheetRowsFromPatients(rows: SheetRow[], patients: Patient[]): SheetRow[] {
  if (!rows.length || !patients.length) return rows

  const byPatientId = new Map<string, Patient>()
  for (const p of patients) {
    const k = String(p.patient_id ?? '').trim().toLowerCase()
    if (k) byPatientId.set(k, p)
  }

  return rows.map((row) => {
    const pid = row.patient_id != null ? String(row.patient_id).trim() : ''
    if (!pid) return row

    const patient = byPatientId.get(pid.toLowerCase())
    if (!patient) return row

    let changed = false
    const next: SheetRow = { ...row }

    if (isEmptyPatientCell(next.patient_first_name) && patient.first_name != null && String(patient.first_name).trim() !== '') {
      next.patient_first_name = patient.first_name
      changed = true
    }
    if (isEmptyPatientCell(next.last_initial) && patient.last_name != null && String(patient.last_name).trim() !== '') {
      next.last_initial = patient.last_name.charAt(0)
      changed = true
    }
    if (isEmptyPatientCell(next.patient_last_name) && patient.last_name != null && String(patient.last_name).trim() !== '') {
      next.patient_last_name = patient.last_name
      changed = true
    }
    if (isEmptyPatientCell(next.patient_insurance) && patient.insurance != null && String(patient.insurance).trim() !== '') {
      next.patient_insurance = patient.insurance
      changed = true
    }
    if (isEmptyPatientCell(next.patient_copay) && patient.copay != null && String(patient.copay).trim() !== '') {
      next.patient_copay = patient.copay
      changed = true
    }
    if (isEmptyPatientCell(next.patient_coinsurance) && patient.coinsurance != null && String(patient.coinsurance).trim() !== '') {
      next.patient_coinsurance = patient.coinsurance
      changed = true
    }

    if (changed) {
      next.updated_at = new Date().toISOString()
    }
    return changed ? next : row
  })
}

/**
 * For rows whose patient_id matches a patient snapshot, fill only empty denormalized patient columns.
 * This mirrors Patient Info behavior (preserve in-flight/provider-entered values) and avoids late save clobber.
 */
export function applyCoPatientSnapshotToSheetRows(rows: SheetRow[], patients: Patient[]): SheetRow[] {
  if (!rows.length || !patients.length) return rows

  const byPatientId = new Map<string, Patient>()
  for (const p of patients) {
    const k = String(p.patient_id ?? '').trim().toLowerCase()
    if (k) byPatientId.set(k, p)
  }

  return rows.map((row) => {
    const pid = row.patient_id != null ? String(row.patient_id).trim() : ''
    if (!pid) return row
    const patient = byPatientId.get(pid.toLowerCase())
    if (!patient) return row

    let changed = false
    const next: SheetRow = { ...row }

    if (isEmptyPatientCell(next.patient_first_name) && patient.first_name != null && String(patient.first_name).trim() !== '') {
      next.patient_first_name = patient.first_name
      changed = true
    }
    if (isEmptyPatientCell(next.last_initial) && patient.last_name != null && String(patient.last_name).trim() !== '') {
      next.last_initial = patient.last_name.charAt(0)
      changed = true
    }
    if (isEmptyPatientCell(next.patient_last_name) && patient.last_name != null && String(patient.last_name).trim() !== '') {
      next.patient_last_name = patient.last_name
      changed = true
    }
    if (isEmptyPatientCell(next.patient_insurance) && patient.insurance != null && String(patient.insurance).trim() !== '') {
      next.patient_insurance = patient.insurance
      changed = true
    }
    if (isEmptyPatientCell(next.patient_copay) && patient.copay != null && String(patient.copay).trim() !== '') {
      next.patient_copay = patient.copay
      changed = true
    }
    if (isEmptyPatientCell(next.patient_coinsurance) && patient.coinsurance != null && String(patient.coinsurance).trim() !== '') {
      next.patient_coinsurance = patient.coinsurance
      changed = true
    }

    if (changed) next.updated_at = new Date().toISOString()
    return changed ? next : row
  })
}
