import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Patient, IsLockPatients } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { v4 as uuidv4 } from 'uuid'
import { copayTextCellRenderer, coinsuranceTextCellRenderer } from '@/lib/handsontableCustomRenderers'
import { toDisplayValue, toStoredString } from '@/lib/utils'

function nextEmptyNumericIdSuffix(rows: { id: string }[]): number {
  let max = -1
  for (const r of rows) {
    const m = /^empty-(\d+)$/.exec(r.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

function isHandsontableUndoRedoSource(source?: string) {
  return source === 'UndoRedo.undo' || source === 'UndoRedo.redo'
}

function mergePatientFromGridRow(
  patient: Patient,
  row: (string | number | null | undefined)[]
): Patient {
  const copayStr = row[4] === '' || row[4] == null || row[4] === 'null' ? null : String(row[4])
  const coinsStr = row[5] === '' || row[5] == null || row[5] === 'null' ? null : String(row[5])
  return {
    ...patient,
    patient_id: toStoredString(String(row[0] ?? '')) ?? '',
    first_name: toStoredString(String(row[1] ?? '')) ?? '',
    last_name: toStoredString(String(row[2] ?? '')) ?? '',
    insurance: toStoredString(String(row[3] ?? '')) || null,
    copay: copayStr,
    coinsurance: coinsStr,
  }
}

interface PatientsTabProps {
  clinicId: string
  canEdit: boolean
  onDelete?: (patientId: string) => void
  isLockPatients?: IsLockPatients | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockPatients) => boolean
  isInSplitScreen?: boolean
  /** Optional: called after a new patient is successfully saved */
  onPatientCreated?: (patient: Patient) => void
  /** Optional: called with the full batch of new patients after save (e.g. for parent-side sync) */
  onPatientsCreated?: (patients: Patient[]) => void
  /** Register a flush function to call before switching away from this tab (so pending save completes with full row data) */
  onRegisterFlushBeforeTabLeave?: (flush: () => Promise<void>) => void
  /** When viewing a backup version, parent passes the patient list from backup. */
  overridePatients?: Patient[] | null
  isViewingBackup?: boolean
  /** When viewing backup, a value that changes when the user selects a different version, so the grid refreshes. */
  backupVersionKey?: number
}

export default function PatientsTab({ clinicId, canEdit, onDelete, isLockPatients, onLockColumn, isColumnLocked, isInSplitScreen, onPatientCreated, onPatientsCreated, onRegisterFlushBeforeTabLeave, overridePatients = null, isViewingBackup = false, backupVersionKey = 0 }: PatientsTabProps) {
  const { userProfile } = useAuth()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const patientsRef = useRef<Patient[]>([])
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const hotRef = useRef<Handsontable | null>(null)
  /** Stable temporary patient_id per row id so multiple cell edits on a new row upsert one record, not one per edit */
  const pendingPatientIdByRowIdRef = useRef<Map<string, string>>(new Map())
  /** Stable UUID for INSERT upserts per placeholder row (DBs without id default still work). */
  const pendingInsertUuidByPlaceholderIdRef = useRef<Map<string, string>>(new Map())
  /** One in-flight list fetch per clinic (React Strict Mode / quick remount dedupes duplicate `patients` queries). */
  const patientsListInflightRef = useRef<Map<string, Promise<void>>>(new Map())

  /** Handsontable row index in hooks is visual when column sorting is on; patients[] is physical order. */
  const physicalRowFromHot = useCallback((visualRow: number) => {
    const hot = hotRef.current
    if (!hot || (hot as { isDestroyed?: boolean }).isDestroyed) return visualRow
    try {
      const p = hot.toPhysicalRow(visualRow)
      if (typeof p === 'number' && !Number.isNaN(p) && p >= 0) return p
    } catch {
      /* ignore */
    }
    return visualRow
  }, [])
  const savePatientsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInProgressRef = useRef(false)
  const savePendingRef = useRef(false)
  const [runPendingSaveTrigger, setRunPendingSaveTrigger] = useState(0)
  const savePatientsRef = useRef<(p: Patient[]) => Promise<void>>(null as any)
  /** Snapshot of last saved data per patient id so we only send changed rows to the DB */
  const lastSavedSnapshotRef = useRef<Map<string, { patient_id: string; first_name: string; last_name: string; insurance: string | null; copay: string | number | null; coinsurance: string | number | null }>>(new Map())
  /** Track last edited row so we can flush save when user leaves the row (edits a different row) */
  const lastEditedRowRef = useRef<number | null>(null)
  /** When true, save was triggered by row leave (not debounce); only then do we call onPatientCreated so provider sheets get full row data */
  const saveTriggeredByRowLeaveRef = useRef(false)
  /** Track last selected row so we can flush save when user selects another row (click or tab) */
  const lastSelectedRowRef = useRef<number | null>(null)
  /** When debounced save saves a new patient, we store its real id so flush (0 to process) can still call onPatientCreated */
  const lastNewPatientIdFromDebounceRef = useRef<string | null>(null)
  /** Resolve when current save completes; used by flush to wait for in-progress save then run save again with row-leave flag */
  const saveCompletePromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  /** Set when user leaves row via selection (afterSelection); cleared when we run row-leave save from handlePatientsHandsontableChange so we save after any pending afterChange */
  const pendingRowLeaveSaveRef = useRef(false)
  const pendingRowLeaveSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const [structureVersion, setStructureVersion] = useState(0)
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())
  const lockData = isLockPatients || null

  const createEmptyPatient = useCallback((index: number): Patient => ({
    id: `empty-${index}`,
    clinic_id: clinicId,
    patient_id: '',
    first_name: '',
    last_name: '',
    subscriber_id: null,
    insurance: null,
    copay: null,
    coinsurance: null,
    date_of_birth: null,
    phone: null,
    email: null,
    address: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }), [clinicId])

  const fetchPatients = useCallback(async () => {
    const inflightKey = clinicId
    const existing = patientsListInflightRef.current.get(inflightKey)
    if (existing) {
      await existing
      return
    }
    const run = async () => {
      try {
      const { data, error } = await apiClient
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        // No sorting - preserve exact order from database (typically creation order)

      if (error) throw error
      const fetchedPatients = data || []
      // Seed "last saved" snapshot so we only save rows that change after load
      fetchedPatients.forEach(p => {
        lastSavedSnapshotRef.current.set(p.id, {
          patient_id: p.patient_id ?? '',
          first_name: (p.first_name != null && p.first_name !== 'null') ? p.first_name : '',
          last_name: (p.last_name != null && p.last_name !== 'null') ? p.last_name : '',
          insurance: (p.insurance != null && p.insurance !== 'null') ? p.insurance : null,
          copay: p.copay != null ? p.copay : null,
          coinsurance: p.coinsurance != null ? p.coinsurance : null,
        })
      })

      setPatients(currentPatients => {
        const fetchedPatientsMap = new Map<string, Patient>()
        fetchedPatients.forEach(p => fetchedPatientsMap.set(p.id, p))

        // Preserve visual table order: walk current rows in order (like BillingTodoTab / AccountsReceivableTab)
        const preservedOrder: Patient[] = []
        currentPatients.forEach(p => {
          if (p.id.startsWith('new-') || p.id.startsWith('empty-')) {
            preservedOrder.push(p)
          } else {
            const freshData = fetchedPatientsMap.get(p.id)
            if (freshData) {
              preservedOrder.push({
                ...freshData,
                first_name: (freshData.first_name != null && freshData.first_name !== 'null') ? freshData.first_name : '',
                last_name: (freshData.last_name != null && freshData.last_name !== 'null') ? freshData.last_name : '',
                insurance: (freshData.insurance != null && freshData.insurance !== 'null') ? freshData.insurance : null,
              })
              fetchedPatientsMap.delete(p.id)
            }
          }
        })
        const newFetchedPatients = Array.from(fetchedPatientsMap.values()).map(px => ({
          ...px,
          first_name: (px.first_name != null && px.first_name !== 'null') ? px.first_name : '',
          last_name: (px.last_name != null && px.last_name !== 'null') ? px.last_name : '',
          insurance: (px.insurance != null && px.insurance !== 'null') ? px.insurance : null,
        }))
        const updated = [...preservedOrder, ...newFetchedPatients]

        // Keep non-empty rows first, then empty rows (allow more than 200 rows)
        const nonEmpty = updated.filter(p => !p.id.startsWith('empty-'))
        const emptyOnes = updated.filter(p => p.id.startsWith('empty-'))
        let result = [...nonEmpty, ...emptyOnes]

        // When fewer than 200 rows, add empty rows to reach 200
        const totalRows = result.length
        const emptyRowsNeeded = Math.max(0, 200 - totalRows)
        const existingEmptyCount = result.filter(p => p.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyPatient(existingEmptyCount + i)
        )
        return [...result, ...newEmptyRows]
      })
    } catch (error) {
      console.error('[PatientData] Error fetching patients:', error)
    } finally {
      setLoading(false)
    }
    }
    const flight = run()
    patientsListInflightRef.current.set(inflightKey, flight)
    try {
      await flight
    } finally {
      patientsListInflightRef.current.delete(inflightKey)
    }
  }, [clinicId, createEmptyPatient])

  useEffect(() => {
    patientsRef.current = patients
  }, [patients])

  // On unmount (or before clinicId change), flush any pending debounced save so the last edit is not lost
  useEffect(() => {
    return () => {
      if (savePatientsTimeoutRef.current) {
        clearTimeout(savePatientsTimeoutRef.current)
        savePatientsTimeoutRef.current = null
        savePatientsRef.current?.(patientsRef.current)?.catch(err => {
          console.error('[PatientData] Flush save on unmount failed:', err)
        })
      }
    }
  }, [])

  useEffect(() => {
    if (!clinicId) return
    if (isViewingBackup && overridePatients) {
      setPatients(overridePatients)
      setLoading(false)
      return
    }
    fetchPatients().then(() => {
      setStructureVersion((v) => v + 1)
    })
  }, [clinicId, fetchPatients, isViewingBackup, overridePatients])

  const savePatients = useCallback(async (patientsToSave: Patient[]) => {
    const flushTriggered = saveTriggeredByRowLeaveRef.current

    if (!clinicId || !userProfile) {
      return
    }

    // Only process: (1) new/empty rows with data, (2) existing rows that are dirty vs last saved snapshot
    const normalize = (p: Patient) => ({
      patient_id: p.patient_id ?? '',
      first_name: (p.first_name != null && p.first_name !== 'null') ? p.first_name : '',
      last_name: (p.last_name != null && p.last_name !== 'null') ? p.last_name : '',
      insurance: (p.insurance != null && p.insurance !== 'null') ? p.insurance : null,
      copay: p.copay != null ? p.copay : null,
      coinsurance: p.coinsurance != null ? p.coinsurance : null,
    })
    const patientsToProcess = patientsToSave.filter(p => {
      const hasData = p.patient_id || p.first_name || p.last_name || p.insurance || p.copay !== null || p.coinsurance !== null
      if (!hasData) return false
      if (p.id.startsWith('empty-') || p.id.startsWith('new-')) return true
      const snap = lastSavedSnapshotRef.current.get(p.id)
      const current = normalize(p)
      if (!snap) return true
      return snap.patient_id !== current.patient_id || snap.first_name !== current.first_name || snap.last_name !== current.last_name || snap.insurance !== current.insurance || snap.copay !== current.copay || snap.coinsurance !== current.coinsurance
    })

    if (patientsToProcess.length === 0) {
      saveTriggeredByRowLeaveRef.current = false
      lastNewPatientIdFromDebounceRef.current = null
      return
    }


    saveInProgressRef.current = true
    let resolveSaveComplete!: () => void
    const saveCompletePromise = new Promise<void>(r => { resolveSaveComplete = r })
    saveCompletePromiseRef.current = { promise: saveCompletePromise, resolve: resolveSaveComplete }
    try {
      // Store saved patients with their database responses to update in place
      const savedPatientsMap = new Map<string, Patient>() // Map old ID -> new Patient data
      // Rows whose patient_id was auto-generated this save (user had not entered Patient ID yet). Don't send to provider sheets until user enters a real ID.
      const patientIdGeneratedThisSave = new Set<string>()
      // Patients we updated by id (e.g. user later filled Patient ID after right-to-left entry). Send to provider sheets so a row appears.
      const updatedPatientsToSend: Patient[] = []

      // Process each patient
      for (let i = 0; i < patientsToProcess.length; i++) {
        const patient = patientsToProcess[i]
        const oldId = patient.id // Store the old ID to find it in state

        // Generate patient_id if missing; reuse same temp id for this row so multiple cell edits upsert one record
        let finalPatientId = patient.patient_id || ''
        if (!finalPatientId) {
          patientIdGeneratedThisSave.add(oldId)
          const existing = pendingPatientIdByRowIdRef.current.get(oldId)
          if (existing) {
            finalPatientId = existing
          } else {
            const timestamp = Date.now().toString().slice(-6)
            const initials = `${(patient.first_name || '').charAt(0)}${(patient.last_name || '').charAt(0)}`.toUpperCase() || 'PT'
            finalPatientId = `${initials}${timestamp}`
            pendingPatientIdByRowIdRef.current.set(oldId, finalPatientId)
          }
        }

        // Prepare patient data (never send string "null" to DB)
        const patientData: Record<string, unknown> = {
          clinic_id: clinicId,
          patient_id: finalPatientId,
          first_name: (patient.first_name && patient.first_name !== 'null') ? patient.first_name : null,
          last_name: (patient.last_name && patient.last_name !== 'null') ? patient.last_name : null,
          insurance: (patient.insurance && patient.insurance !== 'null') ? patient.insurance : null,
          copay: patient.copay != null ? patient.copay : null,
          coinsurance: patient.coinsurance != null ? patient.coinsurance : null,
          updated_at: new Date().toISOString(),
        }

        let savedPatient: Patient | null = null

        // If patient has a real database ID (not new- or empty-), update by ID
        if (!patient.id.startsWith('new-') && !patient.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await apiClient
            .from('patients')
            .update(patientData)
            .eq('id', patient.id)
            .select()

          if (!updateError && updateData && updateData.length > 0) {
            savedPatient = updateData[0] as Patient
            savedPatientsMap.set(oldId, savedPatient)
            lastSavedSnapshotRef.current.set(savedPatient.id, {
              patient_id: savedPatient.patient_id ?? '',
              first_name: (savedPatient.first_name != null && savedPatient.first_name !== 'null') ? savedPatient.first_name : '',
              last_name: (savedPatient.last_name != null && savedPatient.last_name !== 'null') ? savedPatient.last_name : '',
              insurance: (savedPatient.insurance != null && savedPatient.insurance !== 'null') ? savedPatient.insurance : null,
              copay: savedPatient.copay != null ? savedPatient.copay : null,
              coinsurance: savedPatient.coinsurance != null ? savedPatient.coinsurance : null,
            })
            if (oldId !== savedPatient.id) lastSavedSnapshotRef.current.delete(oldId)
            // If parent passes onPatientsCreated, it can react to updates (e.g. sync to provider sheets); otherwise unused.
            if (savedPatient.patient_id != null && String(savedPatient.patient_id).trim() !== '') updatedPatientsToSend.push(savedPatient)
            continue // Update successful, move to next patient
          }
          if (updateError) {
            console.error('[PatientData] update failed:', updateError)
            throw new Error(updateError.message || 'Failed to update patient')
          }
          // Update matched 0 rows (wrong id, clinic scope, etc.). Do not upsert — that would INSERT without id on DBs missing a default, or create duplicates.
          throw new Error(
            'Could not save patient: row not found or not allowed for your clinics. Refresh the page and try again.',
          )
        }

        // Upsert only for new placeholder rows (new- / empty- ids)
        if (oldId.startsWith('empty-') || oldId.startsWith('new-')) {
          let insertId = pendingInsertUuidByPlaceholderIdRef.current.get(oldId)
          if (!insertId) {
            insertId = uuidv4()
            pendingInsertUuidByPlaceholderIdRef.current.set(oldId, insertId)
          }
          patientData.id = insertId
        }

        const { error: upsertError, data: upsertData } = await apiClient
          .from('patients')
          .upsert(patientData, {
            onConflict: 'clinic_id,patient_id',
            ignoreDuplicates: false
          })
          .select()

        if (upsertError) {
          console.error('[PatientData] Error upserting patient:', upsertError, patientData)
          throw upsertError
        }
        
        if (upsertData && upsertData.length > 0) {
          savedPatient = upsertData[0] as Patient
          pendingInsertUuidByPlaceholderIdRef.current.delete(oldId)
          savedPatientsMap.set(oldId, savedPatient) // Map old ID to new patient data
          if (!flushTriggered && (oldId.startsWith('empty-') || oldId.startsWith('new-'))) {
            lastNewPatientIdFromDebounceRef.current = savedPatient.id
          }
          lastSavedSnapshotRef.current.set(savedPatient.id, {
            patient_id: savedPatient.patient_id ?? '',
            first_name: (savedPatient.first_name != null && savedPatient.first_name !== 'null') ? savedPatient.first_name : '',
            last_name: (savedPatient.last_name != null && savedPatient.last_name !== 'null') ? savedPatient.last_name : '',
            insurance: (savedPatient.insurance != null && savedPatient.insurance !== 'null') ? savedPatient.insurance : null,
            copay: savedPatient.copay != null ? savedPatient.copay : null,
            coinsurance: savedPatient.coinsurance != null ? savedPatient.coinsurance : null,
          })
          if (oldId !== savedPatient.id) lastSavedSnapshotRef.current.delete(oldId)
        }
      }

      // Update patients in place: only apply id/created_at/updated_at from DB so we don't overwrite in-flight user edits (e.g. user typed copay while insurance save was in progress).
      // Look up by current row id or by the new id we just saved (savedPatientsMap is keyed by oldId).
      setPatients(currentPatients => {
        const byNewId = new Map<string, Patient>()
        savedPatientsMap.forEach((saved, oldId) => {
          byNewId.set(saved.id, saved)
          if (oldId !== saved.id) byNewId.set(oldId, saved)
        })
        return currentPatients.map(patient => {
          const savedPatient = savedPatientsMap.get(patient.id) ?? byNewId.get(patient.id)
          if (savedPatient) {
            const normalized = {
              ...savedPatient,
              first_name: (savedPatient.first_name != null && savedPatient.first_name !== 'null') ? savedPatient.first_name : '',
              last_name: (savedPatient.last_name != null && savedPatient.last_name !== 'null') ? savedPatient.last_name : '',
              insurance: (savedPatient.insurance != null && savedPatient.insurance !== 'null') ? savedPatient.insurance : null,
              copay: (savedPatient.copay != null && String(savedPatient.copay) !== 'null') ? savedPatient.copay : null,
              coinsurance: (savedPatient.coinsurance != null && String(savedPatient.coinsurance) !== 'null') ? savedPatient.coinsurance : null,
            }
            // Merge: keep current row's editable fields so in-flight edits aren't overwritten; only apply id and timestamps from DB
            return {
              ...patient,
              id: normalized.id,
              created_at: normalized.created_at,
              updated_at: normalized.updated_at,
              patient_id: normalized.patient_id,
              clinic_id: normalized.clinic_id,
              subscriber_id: normalized.subscriber_id,
              date_of_birth: normalized.date_of_birth,
              phone: normalized.phone,
              email: normalized.email,
              address: normalized.address,
              // Prefer current state for table-edited fields so typing during save is not clobbered
              first_name: patient.first_name !== undefined ? patient.first_name : normalized.first_name,
              last_name: patient.last_name !== undefined ? patient.last_name : normalized.last_name,
              insurance: patient.insurance !== undefined ? patient.insurance : normalized.insurance,
              copay: patient.copay !== undefined ? patient.copay : normalized.copay,
              coinsurance: patient.coinsurance !== undefined ? patient.coinsurance : normalized.coinsurance,
            }
          }
          return patient
        })
      })

      // Notify parent whenever we saved newly created patients (new-/empty- or lastNewId), so provider sheets get exactly one batch per save. No gate on row-leave: debounce and row-leave both send once per save that created patients.
      if (onPatientCreated || onPatientsCreated) {
        saveTriggeredByRowLeaveRef.current = false
        const toSend: Array<Patient> = []
        const lastNewId = lastNewPatientIdFromDebounceRef.current
        lastNewPatientIdFromDebounceRef.current = null

        savedPatientsMap.forEach((savedPatient, oldId) => {
          // Don't send to provider sheets when patient_id was auto-generated (e.g. user entered data right-to-left and hadn't filled Patient ID yet). Avoids "unknown id" row in Providers tab.
          if (patientIdGeneratedThisSave.has(oldId)) return
          if (oldId.startsWith('new-') || oldId.startsWith('empty-')) {
            const rowData = patientsToSave.find(p => p.id === oldId)
            const merged = rowData
              ? {
                  ...savedPatient,
                  ...rowData,
                  id: savedPatient.id,
                  created_at: savedPatient.created_at,
                  updated_at: savedPatient.updated_at,
                  // patient_id: always from DB when present so provider sheets get the real ID
                  patient_id: (savedPatient.patient_id != null && savedPatient.patient_id !== '') ? savedPatient.patient_id : (rowData.patient_id || savedPatient.patient_id || ''),
                  // Prefer table state (rowData) for display fields so payload matches what user sees; fall back to DB
                  first_name: (rowData.first_name != null && rowData.first_name !== '') ? rowData.first_name : (savedPatient.first_name ?? ''),
                  last_name: (rowData.last_name != null && rowData.last_name !== '') ? rowData.last_name : (savedPatient.last_name ?? ''),
                  insurance: (rowData.insurance != null && rowData.insurance !== '') ? rowData.insurance : (savedPatient.insurance ?? null),
                  copay: rowData.copay != null ? rowData.copay : savedPatient.copay,
                  coinsurance: rowData.coinsurance != null ? rowData.coinsurance : savedPatient.coinsurance,
                }
              : savedPatient
            toSend.push(merged)
          } else if (lastNewId && savedPatient.id === lastNewId) {
            const rowData = patientsToSave.find(p => p.id === lastNewId)
            const merged = rowData
              ? {
                  ...savedPatient,
                  ...rowData,
                  id: savedPatient.id,
                  created_at: savedPatient.created_at,
                  updated_at: savedPatient.updated_at,
                  patient_id: (savedPatient.patient_id != null && savedPatient.patient_id !== '') ? savedPatient.patient_id : (rowData.patient_id || savedPatient.patient_id || ''),
                  first_name: (rowData.first_name != null && rowData.first_name !== '') ? rowData.first_name : (savedPatient.first_name ?? ''),
                  last_name: (rowData.last_name != null && rowData.last_name !== '') ? rowData.last_name : (savedPatient.last_name ?? ''),
                  insurance: (rowData.insurance != null && rowData.insurance !== '') ? rowData.insurance : (savedPatient.insurance ?? null),
                  copay: rowData.copay != null ? rowData.copay : savedPatient.copay,
                  coinsurance: rowData.coinsurance != null ? rowData.coinsurance : savedPatient.coinsurance,
                }
              : savedPatient
            toSend.push(merged)
          }
        })
        const allToSend = [...toSend, ...updatedPatientsToSend]
        if (allToSend.length > 0) {
          if (onPatientsCreated) {
            await Promise.resolve(onPatientsCreated(allToSend))
          } else {
            allToSend.forEach(patientToSend => onPatientCreated!(patientToSend))
          }
        }
      } else if (saveTriggeredByRowLeaveRef.current) {
        saveTriggeredByRowLeaveRef.current = false
      }
    } catch (error: any) {
      console.error('[PatientData] SAVE FAILED — error writing to database:', error)
      alert(error?.message || 'Failed to save patient. Please try again.')
    } finally {
      saveInProgressRef.current = false
      saveCompletePromiseRef.current?.resolve()
      saveCompletePromiseRef.current = null
      if (savePendingRef.current) {
        savePendingRef.current = false
        setRunPendingSaveTrigger(t => t + 1)
      }
    }
  }, [clinicId, userProfile, fetchPatients, onPatientCreated, onPatientsCreated])

  savePatientsRef.current = savePatients

  // Expose flush so parent can run save (with row-leave flag) before switching away from Patient Info tab
  useEffect(() => {
    if (!onRegisterFlushBeforeTabLeave) return
    const flush = async () => {
      // Commit any in-progress cell edit so patientsRef includes the latest value before we save.
      // Without this, switching tabs while editing can save stale row data and the new patient won't appear until a full reload.
      const hot = hotRef.current
      try {
        const anyHot: any = hot as any
        if (anyHot?.isEditing?.()) {
          const editor: any = anyHot.getActiveEditor?.()
          editor?.finishEditing?.()
        }
      } catch {
        // ignore
      }
      try {
        ;(hot as any)?.deselectCell?.()
      } catch {
        // ignore
      }
      // Let Handsontable propagate afterChange → React state/ref updates.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

      if (savePatientsTimeoutRef.current) {
        clearTimeout(savePatientsTimeoutRef.current)
        savePatientsTimeoutRef.current = null
      }
      // If save is in progress, wait for it to finish then run save again with row-leave flag so onPatientsCreated runs
      if (saveInProgressRef.current && saveCompletePromiseRef.current) {
        await saveCompletePromiseRef.current.promise
      }
      saveTriggeredByRowLeaveRef.current = true
      await savePatients(patientsRef.current)
    }
    onRegisterFlushBeforeTabLeave(flush)
  }, [onRegisterFlushBeforeTabLeave, savePatients])

  useEffect(() => {
    if (runPendingSaveTrigger === 0) return
    savePatientsRef.current(patientsRef.current).catch(err => {
      console.error('[PatientsTab] Error in pending save:', err)
    })
  }, [runPendingSaveTrigger])

  // Note: savePatientsImmediately removed - we now call savePatients directly with updated data
  // Note: handleUpdatePatient removed - state is updated directly in handlePatientsHandsontableChange

  const handleDeletePatient = useCallback(async (patientId: string) => {
    if (patientId.startsWith('new-')) {
      setPatients(prev => prev.filter(p => p.id !== patientId))
      setStructureVersion(v => v + 1)
      return
    }

    try {
      const { error } = await apiClient
        .from('patients')
        .delete()
        .eq('id', patientId)
      
      if (error) throw error
      
      await fetchPatients()
      setStructureVersion(v => v + 1)
      if (onDelete) onDelete(patientId)
    } catch (error) {
      console.error('[PatientData] Error deleting patient:', error)
      alert(`Failed to delete patient: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [fetchPatients, onDelete])

  const padPatientsTo200 = useCallback(
    (list: Patient[]) => {
      const result = [...list]
      while (result.length > 200) {
        const last = result[result.length - 1]
        if (last?.id.startsWith('empty-')) result.pop()
        else break
      }
      const trimmed = result.length > 200 ? result.slice(0, 200) : result
      const out = [...trimmed]
      while (out.length < 200) {
        out.push(createEmptyPatient(nextEmptyNumericIdSuffix(out)))
      }
      return out
    },
    [createEmptyPatient]
  )

  const syncPatientsFromHotAfterUndoRedo = useCallback(() => {
    const hot = hotRef.current
    if (!hot || (hot as any).isDestroyed) return
    if (!canEdit) return
    try {
      const grid = hot.getData() as (string | number | null | undefined)[][]
      const prev = patientsRef.current
      const next = [...prev]
      for (let v = 0; v < grid.length; v++) {
        const phys = physicalRowFromHot(v)
        if (phys < 0) continue
        while (next.length <= phys) {
          next.push(createEmptyPatient(nextEmptyNumericIdSuffix(next)))
        }
        const row = grid[v]
        const p = next[phys] ?? createEmptyPatient(nextEmptyNumericIdSuffix(next))
        next[phys] = mergePatientFromGridRow(p, row)
      }
      const padded = padPatientsTo200(next)
      patientsRef.current = padded
      setPatients(padded)
      void savePatients(padded).catch((err) => console.error('savePatients after HOT undo/redo sync', err))
    } catch (e) {
      console.error('syncPatientsFromHotAfterUndoRedo', e)
    }
  }, [canEdit, createEmptyPatient, padPatientsTo200, physicalRowFromHot, savePatients])

  const handleAfterCreateRow = useCallback(
    (index: number, amount: number, source?: string) => {
      if (!canEdit) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      const physIndex = physicalRowFromHot(index)
      setPatients((prev) => {
        const next = [...prev]
        const base = nextEmptyNumericIdSuffix(next)
        for (let i = 0; i < amount; i++) {
          next.splice(physIndex + i, 0, createEmptyPatient(base + i))
        }
        const padded = padPatientsTo200(next)
        patientsRef.current = padded
        return padded
      })
      setStructureVersion((v) => v + 1)
      requestAnimationFrame(() => {
        savePatients(patientsRef.current).catch((err) => console.error('savePatients after HOT create row', err))
      })
    },
    [canEdit, createEmptyPatient, padPatientsTo200, physicalRowFromHot, savePatients]
  )

  const handleAfterRemoveRow = useCallback(
    (_index: number, _amount: number, physicalRows: number[], source?: string) => {
      if (!canEdit) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      const snap = [...patientsRef.current]
      const removed = physicalRows.map((i) => snap[i]).filter(Boolean)
      removed.forEach((p) => {
        if (p.id.startsWith('empty-')) return
        void handleDeletePatient(p.id)
      })
      setPatients((prev) => {
        const rm = new Set(physicalRows)
        const next = padPatientsTo200(prev.filter((_, i) => !rm.has(i)))
        patientsRef.current = next
        return next
      })
      setStructureVersion((v) => v + 1)
      requestAnimationFrame(() => {
        savePatients(patientsRef.current).catch((err) => console.error('savePatients after HOT remove row', err))
      })
    },
    [canEdit, handleDeletePatient, padPatientsTo200, savePatients]
  )

  // Reorder patients when user drags a row; persist order via created_at so reload preserves it
  const handlePatientsRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    setPatients(prev => {
      const arr = [...prev]
      const toMove = movedRows.map(i => arr[i])
      movedRows.sort((a, b) => b - a).forEach(i => arr.splice(i, 1))
      const insertAt = Math.min(finalIndex, arr.length)
      toMove.forEach((item, i) => arr.splice(insertAt + i, 0, item))
      const next = arr
      const realPatients = next.filter(p => !p.id.startsWith('empty-') && !p.id.startsWith('new-'))
      if (realPatients.length > 0) {
        const baseTime = Date.now()
        Promise.all(
          realPatients.map((patient, i) =>
            apiClient
              .from('patients')
              .update({ created_at: new Date(baseTime - i * 1000).toISOString() })
              .eq('id', patient.id)
          )
        ).catch(err => console.error('Failed to persist patient order', err))
      }
      return next
    })
    setStructureVersion(v => v + 1)
  }, [])

  /** When viewing a backup, use override so the grid shows the correct version on first render (avoids one-version-behind bug). */
  const displayPatients = useMemo(
    () => (isViewingBackup && overridePatients && overridePatients.length > 0 ? overridePatients : patients),
    [isViewingBackup, overridePatients, patients]
  )

  const getPatientsHandsontableData = useCallback(() => {
    return displayPatients.map(patient => [
      toDisplayValue(patient.patient_id),
      toDisplayValue(patient.first_name),
      toDisplayValue(patient.last_name),
      toDisplayValue(patient.insurance),
      toDisplayValue(patient.copay),
      toDisplayValue(patient.coinsurance),
    ])
  }, [displayPatients])
  const columnFields: Array<keyof IsLockPatients> = ['patient_id', 'first_name', 'last_name', 'insurance', 'copay', 'coinsurance']
  const columnTitles = ['Patient ID', 'Patient First', 'Patient Last', 'Insurance', 'Copay', 'Coinsurance']

  const patientsCellsCallback = useCallback(
    (row: number, col: number) => {
      const patient = displayPatients[physicalRowFromHot(row)]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${patient?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key) ? { className: 'cell-highlight-yellow' } : {}
    },
    [displayPatients, columnFields, highlightedCells, physicalRowFromHot]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const patient = displayPatients[physicalRowFromHot(row)]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${patient?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [displayPatients, columnFields, highlightedCells, physicalRowFromHot]
  )

  const handleCellHighlight = useCallback((row: number, col: number) => {
    const patient = displayPatients[physicalRowFromHot(row)]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${patient?.id ?? `row-${row}`}:${colKey}`
    setHighlightedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [displayPatients, columnFields, physicalRowFromHot])

  // Right-click on column headers to lock/unlock (no lock icon in header)
  useEffect(() => {
    if (!canEdit || !onLockColumn || !isColumnLocked) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let menuEl: HTMLElement | null = null
    let closeListener: ((e: Event) => void) | null = null
    let openedAt = 0

    const hideMenu = () => {
      if (menuEl?.parentNode) menuEl.parentNode.removeChild(menuEl)
      menuEl = null
      if (closeListener) {
        document.removeEventListener('pointerdown', closeListener, true)
        document.removeEventListener('contextmenu', closeListener, true)
        closeListener = null
      }
    }

    const showHeaderContextMenu = (e: MouseEvent, columnName: string) => {
      e.preventDefault()
      e.stopPropagation()
      hideMenu()
      const isLocked = isColumnLocked(columnName as keyof IsLockPatients)
      const menu = document.createElement('div')
      menu.className = 'patient-col-header-context-menu'
      menu.style.cssText = 'position:fixed;z-index:9999;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.4);padding:4px 0;min-width:140px;'
      const item = document.createElement('div')
      item.style.cssText = 'padding:6px 12px;cursor:pointer;white-space:nowrap;font-size:13px;'
      item.textContent = isLocked ? 'Unlock column' : 'Lock column'
      item.onclick = () => {
        onLockColumn(columnName)
        hideMenu()
      }
      menu.appendChild(item)
      document.body.appendChild(menu)
      menuEl = menu
      openedAt = Date.now()
      const x = Math.min(e.clientX, window.innerWidth - 150)
      const y = Math.min(e.clientY, window.innerHeight - 40)
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      closeListener = (evt: Event) => {
        // Ignore same-tick follow-up events from the opener and only close on true outside clicks.
        if (Date.now() - openedAt < 120) return
        const target = evt.target as Node | null
        if (menuEl && target && menuEl.contains(target)) return
        hideMenu()
      }
      setTimeout(() => {
        document.addEventListener('pointerdown', closeListener!, true)
        document.addEventListener('contextmenu', closeListener!, true)
      }, 0)
    }

    const attachContextMenuToHeader = (headerRow: Element | null) => {
      if (!headerRow) return
      const headerCells = Array.from(headerRow.querySelectorAll('th'))
      headerCells.forEach((th) => {
        let cellText = th.textContent?.trim() || ''
        const existingWrapper = th.querySelector('div')
        if (existingWrapper) {
          const titleSpan = existingWrapper.querySelector('span')
          if (titleSpan) cellText = titleSpan.textContent?.trim() || cellText
        }
        cellText = cellText.replace(/🔒|🔓/g, '').trim()
        const columnIndex = columnTitles.findIndex(title => {
          const a = title.toLowerCase().trim()
          const b = cellText.toLowerCase().trim()
          return a === b || b.includes(a) || a.includes(b)
        })
        if (columnIndex === -1 || columnIndex >= columnFields.length) return
        const columnName = columnFields[columnIndex]
        const el = th as HTMLElement
        const prev = (el as any)._patientHeaderContext
        if (prev) el.removeEventListener('contextmenu', prev)
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._patientHeaderContext = handler
        el.addEventListener('contextmenu', handler)
      })
    }

    const attachAll = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      const table = document.querySelector('.handsontable-custom table.htCore')
      if (table) attachContextMenuToHeader(table.querySelector('thead tr'))
      const cloneTop = document.querySelector('.handsontable-custom .ht_clone_top table.htCore')
      if (cloneTop) attachContextMenuToHeader(cloneTop.querySelector('thead tr'))
    }

    timeoutId = setTimeout(attachAll, 300)
    const observer = new MutationObserver(() => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(attachAll, 200)
    })
    const tableContainer = document.querySelector('.handsontable-custom')
    if (tableContainer) observer.observe(tableContainer, { childList: true, subtree: true })
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      observer.disconnect()
      hideMenu()
      document.querySelectorAll('.handsontable-custom th').forEach((th) => {
        const h = (th as any)._patientHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
    }
  }, [canEdit, onLockColumn, isColumnLocked, isLockPatients])

  const getReadOnly = (columnName: keyof IsLockPatients): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  // Memoize so HandsontableWrapper doesn't call updateSettings({ columns }) on every render (which would reset column sort when typing)
  const patientsColumns = useMemo(() => [
    { data: 0, title: 'Patient ID', type: 'text' as const, width: 120, readOnly: !canEdit || getReadOnly('patient_id'), columnSorting: { indicator: true } },
    { data: 1, title: 'Patient First', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('first_name'), columnSorting: { headerAction: false } },
    { data: 2, title: 'Patient Last', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('last_name'), columnSorting: { headerAction: false } },
    { data: 3, title: 'Insurance', type: 'text' as const, width: 150, readOnly: !canEdit || getReadOnly('insurance'), columnSorting: { headerAction: false } },
    { data: 4, title: 'Copay', type: 'text' as const, width: 100, renderer: copayTextCellRenderer, readOnly: !canEdit || getReadOnly('copay'), columnSorting: { headerAction: false } },
    { data: 5, title: 'Coinsurance', type: 'text' as const, width: 100, renderer: coinsuranceTextCellRenderer, readOnly: !canEdit || getReadOnly('coinsurance'), columnSorting: { headerAction: false } },
  ], [canEdit, lockData])
  
  const handlePatientsHandsontableChange = useCallback((changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return

    const currentPatients = patientsRef.current.length > 0 ? patientsRef.current : patients
    const updatedPatients = [...currentPatients]
    const fields: Array<keyof Patient> = ['patient_id', 'first_name', 'last_name', 'insurance', 'copay', 'coinsurance']

    // Detect row leave (user edited a different row) — we'll flush save after applying changes so onPatientCreated gets full row data
    const rowsInChange = [...new Set(changes.map(([r]) => physicalRowFromHot(typeof r === 'number' ? r : 0)))]
    const primaryRow = rowsInChange[0] ?? null
    const prevRow = lastEditedRowRef.current
    const didLeaveRow = prevRow !== null && primaryRow !== null && !rowsInChange.includes(prevRow)

    changes.forEach(([row, col, , newValue]) => {
      const phys = physicalRowFromHot(typeof row === 'number' ? row : 0)
      while (updatedPatients.length <= phys) {
        const existingEmptyCount = updatedPatients.filter(p => p.id.startsWith('empty-')).length
        updatedPatients.push(createEmptyPatient(existingEmptyCount))
      }
      const patient = updatedPatients[phys]
      if (patient) {
        const field = fields[col as number]
        if (field === 'copay' || field === 'coinsurance') {
          const strValue = (newValue === '' || newValue === null || newValue === 'null' || newValue === undefined) ? null : String(newValue)
          updatedPatients[phys] = { ...patient, [field]: strValue, updated_at: new Date().toISOString() } as Patient
        } else if (field === 'insurance') {
          updatedPatients[phys] = { ...patient, [field]: toStoredString(String(newValue ?? '')), updated_at: new Date().toISOString() } as Patient
        } else if (field) {
          updatedPatients[phys] = { ...patient, [field]: toStoredString(String(newValue ?? '')) ?? '', updated_at: new Date().toISOString() } as Patient
        }
      }
    })

    if (updatedPatients.length < 200) {
      const emptyRowsNeeded = 200 - updatedPatients.length
      const existingEmptyCount = updatedPatients.filter(p => p.id.startsWith('empty-')).length
      updatedPatients.push(...Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyPatient(existingEmptyCount + i)))
    }

    lastEditedRowRef.current = primaryRow
    if (primaryRow !== null) lastSelectedRowRef.current = primaryRow

    patientsRef.current = updatedPatients
    setPatients(updatedPatients)

    // When user left the previous row, flush save now (after applying this change) so provider sheets get full row data
    if (didLeaveRow) {
      saveTriggeredByRowLeaveRef.current = true
      if (savePatientsTimeoutRef.current) {
        clearTimeout(savePatientsTimeoutRef.current)
        savePatientsTimeoutRef.current = null
      }
      if (!saveInProgressRef.current) {
        savePatients(patientsRef.current).catch(err => console.error('[PatientInfo→Providers] Error flushing save on row leave:', err))
      }
    }

    // If selection had changed (pendingRowLeaveSaveRef) and we just got afterChange, run row-leave save now so last cell is in patientsRef; cancel fallback timer
    if (pendingRowLeaveSaveRef.current) {
      pendingRowLeaveSaveRef.current = false
      if (pendingRowLeaveSaveTimeoutRef.current) {
        clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
        pendingRowLeaveSaveTimeoutRef.current = null
      }
      saveTriggeredByRowLeaveRef.current = true
      if (savePatientsTimeoutRef.current) {
        clearTimeout(savePatientsTimeoutRef.current)
        savePatientsTimeoutRef.current = null
      }
      if (!saveInProgressRef.current) {
        savePatients(patientsRef.current).catch(err => console.error('[PatientInfo→Providers] Error flushing save (pending row leave):', err))
      }
    }

    // Debounce save so typing multiple cells on a new row upserts one record, not one per cell
    if (savePatientsTimeoutRef.current) clearTimeout(savePatientsTimeoutRef.current)
    savePatientsTimeoutRef.current = setTimeout(() => {
      savePatientsTimeoutRef.current = null
      if (saveInProgressRef.current) {
        savePendingRef.current = true
        return
      }
      savePatients(patientsRef.current).catch(err => {
        console.error('[handlePatientsHandsontableChange] Error in savePatients:', err)
      })
    }, 500)
  }, [patients, savePatients, createEmptyPatient, physicalRowFromHot])

  const handleAfterSelection = useCallback((r: number, _c: number, _r2: number, _c2: number) => {
    const physR = physicalRowFromHot(r)
    const prev = lastSelectedRowRef.current
    if (prev !== null && physR !== prev && !saveInProgressRef.current) {
      // Set flag so handlePatientsHandsontableChange will run row-leave save after any pending afterChange (captures last cell)
      pendingRowLeaveSaveRef.current = true
      if (pendingRowLeaveSaveTimeoutRef.current) clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
      // Fallback: if afterChange never fires (e.g. user just clicked away without editing), run save after delay
      const FALLBACK_MS = 800
      pendingRowLeaveSaveTimeoutRef.current = setTimeout(() => {
        pendingRowLeaveSaveTimeoutRef.current = null
        if (!pendingRowLeaveSaveRef.current) return
        pendingRowLeaveSaveRef.current = false
        saveTriggeredByRowLeaveRef.current = true
        if (savePatientsTimeoutRef.current) {
          clearTimeout(savePatientsTimeoutRef.current)
          savePatientsTimeoutRef.current = null
        }
        savePatients(patientsRef.current).catch(err => console.error('[PatientInfo→Providers] Error flushing save on selection change (fallback):', err))
      }, FALLBACK_MS)
    }
    lastSelectedRowRef.current = physR
  }, [physicalRowFromHot, savePatients])

  const handleAfterDeselect = useCallback(() => {
    if (saveInProgressRef.current) return
    if (lastSelectedRowRef.current === null) return
    if (pendingRowLeaveSaveTimeoutRef.current) {
      clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
      pendingRowLeaveSaveTimeoutRef.current = null
    }
    pendingRowLeaveSaveRef.current = false
    saveTriggeredByRowLeaveRef.current = true
    if (savePatientsTimeoutRef.current) {
      clearTimeout(savePatientsTimeoutRef.current)
      savePatientsTimeoutRef.current = null
    }
    savePatients(patientsRef.current).catch(err => console.error('[PatientInfo→Providers] Error flushing save on deselect (click outside):', err))
  }, [savePatients])

  // ResizeObserver for split screen: fill table height (must run before any early return)
  useEffect(() => {
    if (!isInSplitScreen) return
    const el = tableContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setTableHeight(el.clientHeight)
    })
    ro.observe(el)
    setTableHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [isInSplitScreen])
  
  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-white/70 py-8">Loading patients...</div>
      </div>
    )
  }

  return (
    <div className={isInSplitScreen ? 'p-6 split-pane-tab' : 'p-6'}>
      <div 
        ref={tableContainerRef}
        className="table-container dark-theme" 
        style={{ 
          maxHeight: isInSplitScreen ? undefined : '600px',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflow: isInSplitScreen ? undefined : 'hidden' as const,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          width: '100%',
          maxWidth: '100%',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`patients-${clinicId}`}
          data={getPatientsHandsontableData()}
          dataVersion={structureVersion + (isViewingBackup ? 1000000 + backupVersionKey : 0)}
          columns={patientsColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
          stretchH={isInSplitScreen ? "none" : "all"}
          afterChange={handlePatientsHandsontableChange}
          afterSelection={handleAfterSelection}
          afterDeselect={handleAfterDeselect}
          onAfterRowMove={handlePatientsRowMove}
          afterCreateRow={handleAfterCreateRow}
          afterRemoveRow={handleAfterRemoveRow}
          onAfterUndoRedoSync={syncPatientsFromHotAfterUndoRedo}
          contextMenuWithNativeRows
          onCellHighlight={handleCellHighlight}
          getCellIsHighlighted={getCellIsHighlighted}
          cells={patientsCellsCallback}
          enableFormula={true}
          columnSorting={{ indicator: true }}
          readOnly={!canEdit}
          hotInstanceRef={hotRef}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom billing-todo-sortable"
        />
      </div>
    </div>
  )
}
