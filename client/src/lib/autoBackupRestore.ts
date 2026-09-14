import type { SheetRow } from '@/types'
import { isUuid } from '@/lib/providerSheetRows'

/** Visit identity used to avoid restoring a backup row on top of newer post-backup work. */
export function sheetRowVisitKey(row: Pick<SheetRow, 'patient_id' | 'appointment_date'>): string | null {
  const patientId = typeof row.patient_id === 'string' ? row.patient_id.trim() : ''
  if (!patientId) return null
  const date = typeof row.appointment_date === 'string' ? row.appointment_date.trim().slice(0, 10) : ''
  return `${patientId}|${date}`
}

function rowCreatedAtMs(row: Pick<SheetRow, 'created_at'>): number {
  if (!row.created_at) return 0
  const t = new Date(row.created_at).getTime()
  return Number.isFinite(t) ? t : 0
}

export interface AutoBackupRestorePlan {
  /** Payload to save: remapped backup rows + preserved post-backup rows (UUID kept). */
  rowsToSave: SheetRow[]
  /** Current UUIDs safe to delete (existed at/before backup time). */
  idsToDelete: string[]
  /** Rows created after the backup — kept as-is. */
  preservedRows: SheetRow[]
  /** Backup rows skipped because a newer row already covers the same visit. */
  skippedBackupRowCount: number
  backupCreatedAt: string
}

/**
 * Build a restore that re-applies backup content without wiping work added after the backup.
 *
 * Previous behavior deleted every current UUID and re-inserted the backup ("wipe and recreate").
 * That permanently removed rows Keana/admin added after the snapshot — the Andrene Sep 9 incident.
 *
 * New behavior:
 * - Remap backup UUIDs → `new-restore-*` so missing DB rows still INSERT (blank-sheet recovery).
 * - Delete only current UUIDs created at/before the backup (or with unknown/missing created_at
 *   when they are not clearly newer).
 * - Keep rows with created_at > backup.created_at.
 * - Skip backup visits that collide with a preserved row's patient+date so dedupe cannot overwrite them.
 */
export function buildSafeAutoBackupRestorePlan(
  backupRows: SheetRow[],
  currentRows: SheetRow[],
  backupCreatedAt: string,
  remapIdPrefix: 'new-restore' | 'new-undo' = 'new-restore',
): AutoBackupRestorePlan {
  const backupCreatedAtMs = new Date(backupCreatedAt).getTime()
  const backupTimeKnown = Number.isFinite(backupCreatedAtMs)

  const currentUuidRows = currentRows.filter((r) => isUuid(r.id))
  const preservedRows: SheetRow[] = []
  const idsToDelete: string[] = []

  for (const row of currentUuidRows) {
    const createdMs = rowCreatedAtMs(row)
    // Missing timestamps: treat as replaceable (legacy / client-only rows) unless we cannot parse backup time.
    const isClearlyNewer = backupTimeKnown && createdMs > backupCreatedAtMs
    if (isClearlyNewer) {
      preservedRows.push(row)
    } else {
      idsToDelete.push(row.id)
    }
  }

  const preservedVisitKeys = new Set(
    preservedRows.map(sheetRowVisitKey).filter((k): k is string => Boolean(k)),
  )

  let skippedBackupRowCount = 0
  const remappedBackup: SheetRow[] = []
  for (const row of backupRows) {
    // Skip empty padding rows — padSheetRowsToBase / save filter handle empties.
    if (typeof row.id === 'string' && row.id.startsWith('empty-')) {
      const hasData =
        row.patient_id ||
        row.appointment_date ||
        row.cpt_code ||
        row.appointment_status ||
        row.claim_status ||
        row.notes
      if (!hasData) continue
    }

    const visitKey = sheetRowVisitKey(row)
    if (visitKey && preservedVisitKeys.has(visitKey)) {
      skippedBackupRowCount += 1
      continue
    }

    if (isUuid(row.id)) {
      const newId = `${remapIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      remappedBackup.push({ ...row, id: newId })
    } else {
      remappedBackup.push(row)
    }
  }

  return {
    rowsToSave: [...remappedBackup, ...preservedRows],
    idsToDelete,
    preservedRows,
    skippedBackupRowCount,
    backupCreatedAt,
  }
}
