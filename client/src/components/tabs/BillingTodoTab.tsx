import { useState, useEffect, useCallback, useRef, useMemo, type MutableRefObject } from 'react'
import { apiClient } from '@/lib/apiClient'
import { TodoItem, IsLockBillingTodo } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer, createColoredAutocompleteDropdown } from '@/lib/handsontableCustomRenderers'
import BillingTodoNotes from '@/components/BillingTodoNotes'
import { recordSaveAudit } from '@/lib/recordSaveAudit'

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

function mergeBillingTodoFromGridRow(
  todo: TodoItem,
  row: (string | number | null | undefined)[]
): TodoItem {
  const statusRaw = row[1] != null && row[1] !== '' ? String(row[1]) : ''
  return {
    ...todo,
    display_id: row[0] === '' || row[0] == null || row[0] === 'null' ? null : String(row[0]),
    status: statusRaw,
    issue: row[2] === '' || row[2] == null || row[2] === 'null' ? null : String(row[2]),
    notes: row[3] === '' || row[3] == null || row[3] === 'null' ? null : String(row[3]),
    followup_notes: row[4] === '' || row[4] == null || row[4] === 'null' ? null : String(row[4]),
  }
}

interface BillingTodoTabProps {
  clinicId: string
  canEdit: boolean
  onDelete?: (todoId: string) => void
  isLockBillingTodo?: IsLockBillingTodo | null
  onLockColumn?: (columnName: string) => void
  isColumnLocked?: (columnName: keyof IsLockBillingTodo) => boolean
  isInSplitScreen?: boolean
  exportRef?: MutableRefObject<{ exportToCSV: () => void } | null>
  /** Parent awaits this before switching away so pending edits persist (same as PatientsTab). */
  onRegisterFlushBeforeTabLeave?: (flush: () => Promise<void>) => void
}

export default function BillingTodoTab({ clinicId, canEdit, onDelete, isLockBillingTodo, onLockColumn, isColumnLocked, isInSplitScreen, exportRef, onRegisterFlushBeforeTabLeave }: BillingTodoTabProps) {
  const { userProfile } = useAuth()
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(true)
  const todosRef = useRef<TodoItem[]>([])
  const hotRef = useRef<Handsontable | null>(null)
  const saveTodosTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTodosRef = useRef<(todosToSave: TodoItem[]) => Promise<void>>(null as any)
  const saveInProgressRef = useRef(false)
  const savePendingRef = useRef(false)
  const [runPendingSaveTrigger, setRunPendingSaveTrigger] = useState(0)
  const saveCompletePromiseRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  /** Snapshot of last saved fields per todo id — same idea as PatientsTab lastSavedSnapshotRef */
  const lastSavedSnapshotRef = useRef<Map<string, { display_id: string | null; issue: string | null; notes: string | null; followup_notes: string | null; status: string }>>(new Map())
  const lastEditedRowRef = useRef<number | null>(null)
  const saveTriggeredByRowLeaveRef = useRef(false)
  const lastSelectedRowRef = useRef<number | null>(null)
  const pendingRowLeaveSaveRef = useRef(false)
  const pendingRowLeaveSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  /** Ignore stale fetch responses when clinicId / deps change mid-flight (Silvercrest data-loss race). */
  const fetchGenerationRef = useRef(0)
  const [tableHeight, setTableHeight] = useState(600)
  const [structureVersion, setStructureVersion] = useState(0) // Bump on add/delete row so grid refreshes immediately
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())
  // Archive feature: split the to-do list into "Current" (anything not Complete) and "Archive"
  // (Complete only). Persisted per-clinic in sessionStorage so the tab choice survives tab
  // switches inside this clinic but doesn't bleed across clinics.
  const viewModeStorageKey = `billing-todo-view-mode-${clinicId}`
  const [viewMode, setViewMode] = useState<'current' | 'archive' | 'notes'>(() => {
    try {
      const raw = sessionStorage.getItem(viewModeStorageKey)
      if (raw === 'archive' || raw === 'current' || raw === 'notes') return raw
    } catch { /* sessionStorage unavailable */ }
    return 'current'
  })
  useEffect(() => {
    try { sessionStorage.setItem(viewModeStorageKey, viewMode) } catch { /* sessionStorage unavailable */ }
  }, [viewMode, viewModeStorageKey])

  // Use isLockBillingTodo from props directly - it will update when parent refreshes
  const lockData = isLockBillingTodo || null

  /** Handsontable row index in hooks is visual when column sorting is on; displayedTodos is physical order. */
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

  const createEmptyTodo = useCallback((index: number): TodoItem => ({
    id: `empty-${index}`,
    clinic_id: clinicId,
    display_id: null,
    issue: null,
    status: '',
    notes: null,
    followup_notes: null,
    created_by: userProfile?.id || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
  }), [clinicId, userProfile])

  const normalizeTodoRow = useCallback((t: TodoItem): TodoItem => ({
    ...t,
    display_id: (t.display_id && t.display_id !== 'null') ? t.display_id : null,
    issue: (t.issue && t.issue !== 'null') ? t.issue : null,
    notes: (t.notes && t.notes !== 'null') ? t.notes : null,
    followup_notes: (t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : null,
  }), [])

  /** True empty placeholder rows only (not rows with status/issue/display_id data on an empty- id). */
  const isBillingTodoEmptyPlaceholder = useCallback((t: TodoItem) => {
    return (
      t.id.startsWith('empty-') &&
      !t.display_id &&
      !t.issue &&
      !t.notes &&
      !t.followup_notes &&
      (!t.status || t.status === '' || t.status === 'Open')
    )
  }, [])

  /** Incomplete (non-Complete) data rows first, then Complete, then blank placeholders at the end. */
  const sortBillingTodosCompleteAtBottom = useCallback(
    (list: TodoItem[]): TodoItem[] => {
      const dataRows = list.filter((t) => !isBillingTodoEmptyPlaceholder(t))
      const incomplete = dataRows.filter((t) => t.status !== 'Complete')
      const complete = dataRows.filter((t) => t.status === 'Complete')
      const emptyRows = list.filter((t) => isBillingTodoEmptyPlaceholder(t))
      return [...incomplete, ...complete, ...emptyRows]
    },
    [isBillingTodoEmptyPlaceholder]
  )

  /** Display minimum + user-requested extra rows. Real rows are NEVER stripped; only trailing
   * empty placeholders past the target are trimmed. */
  const BILLING_TODOS_BASE_ROWS = 200
  const BILLING_TODOS_ROWS_STEP = 50
  const extraEmptyRowsStorageKey = clinicId ? `billing-todo-extra-rows-${clinicId}` : null
  const [extraEmptyRows, setExtraEmptyRows] = useState(() => {
    if (!clinicId) return 0
    try {
      const raw = localStorage.getItem(`billing-todo-extra-rows-${clinicId}`)
      const n = raw == null ? 0 : parseInt(raw, 10)
      return Number.isFinite(n) && n >= 0 ? n : 0
    } catch {
      return 0
    }
  })
  useEffect(() => {
    if (!extraEmptyRowsStorageKey) return
    try {
      localStorage.setItem(extraEmptyRowsStorageKey, String(extraEmptyRows))
    } catch {
      // ignore: persistence is best-effort.
    }
  }, [extraEmptyRowsStorageKey, extraEmptyRows])
  // Reset per-clinic extra-row preference when switching clinics (component may not remount).
  useEffect(() => {
    if (!clinicId) {
      setExtraEmptyRows(0)
      return
    }
    try {
      const raw = localStorage.getItem(`billing-todo-extra-rows-${clinicId}`)
      const n = raw == null ? 0 : parseInt(raw, 10)
      setExtraEmptyRows(Number.isFinite(n) && n >= 0 ? n : 0)
    } catch {
      setExtraEmptyRows(0)
    }
  }, [clinicId])

  const padBillingTodosTo200 = useCallback(
    (list: TodoItem[]) => {
      const target = BILLING_TODOS_BASE_ROWS + extraEmptyRows
      const result = [...list]
      while (result.length > target) {
        const last = result[result.length - 1]
        if (last && isBillingTodoEmptyPlaceholder(last)) result.pop()
        else break
      }
      // Pad UP to target when shorter — never truncate real rows when longer. Same bug class as
      // PatientsTab.padPatientsTo200. Real to-do rows must be preserved at all costs.
      while (result.length < target) {
        result.push(createEmptyTodo(nextEmptyNumericIdSuffix(result)))
      }
      return result
    },
    [createEmptyTodo, isBillingTodoEmptyPlaceholder, extraEmptyRows]
  )

  const fetchTodos = useCallback(async () => {
    const generation = ++fetchGenerationRef.current
    try {
      const { data: todosData, error: todosError } = await apiClient
        .from('todo_lists')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })

      if (todosError) throw todosError
      if (generation !== fetchGenerationRef.current) return

      const fetchedTodos = (todosData || []).map(normalizeTodoRow)

      fetchedTodos.forEach((t) => {
        lastSavedSnapshotRef.current.set(t.id, {
          display_id: t.display_id,
          issue: t.issue,
          notes: t.notes,
          followup_notes: t.followup_notes,
          status: (t.status === 'Open' || !t.status) ? '' : t.status,
        })
      })

      setTodos((currentTodos) => {
        if (generation !== fetchGenerationRef.current) return currentTodos

        if (currentTodos.length === 0) {
          // Never slice real rows — a clinic with >200 items (Current + Archive) used to lose
          // the oldest entries on every cold load (created_at DESC → oldest past 200 dropped).
          return padBillingTodosTo200(sortBillingTodosCompleteAtBottom(fetchedTodos))
        }

        const fetchedTodosMap = new Map<string, TodoItem>()
        fetchedTodos.forEach((t) => fetchedTodosMap.set(t.id, t))

        const preservedOrder: TodoItem[] = []
        currentTodos.forEach((t) => {
          if (t.id.startsWith('new-') || t.id.startsWith('empty-')) {
            preservedOrder.push(t)
          } else {
            const freshData = fetchedTodosMap.get(t.id)
            if (freshData) {
              preservedOrder.push(normalizeTodoRow(freshData))
              fetchedTodosMap.delete(t.id)
            } else {
              // Keep local UUID rows missing from this response. A concurrent fetch that started
              // before an insert finished used to drop the just-saved row from the UI (looked
              // like random item loss). Prefer a brief ghost over silent data loss; true deletes
              // remove the row from local state in handleDeleteTodo first.
              preservedOrder.push(t)
            }
          }
        })
        const newFetchedTodos = Array.from(fetchedTodosMap.values()).map(normalizeTodoRow)
        const updated = [...preservedOrder, ...newFetchedTodos]

        const nonEmpty = updated.filter((t) => !t.id.startsWith('empty-'))
        const emptyOnes = updated.filter((t) => t.id.startsWith('empty-'))
        return padBillingTodosTo200(sortBillingTodosCompleteAtBottom([...nonEmpty, ...emptyOnes]))
      })
    } catch (error) {
      console.error('Error fetching todos:', error)
    } finally {
      if (generation === fetchGenerationRef.current) setLoading(false)
    }
  }, [clinicId, normalizeTodoRow, sortBillingTodosCompleteAtBottom, padBillingTodosTo200])

  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  // Clear local state when switching clinics so unsaved empty-* rows cannot be saved under the
  // wrong clinic_id (component often stays mounted across clinic navigation).
  useEffect(() => {
    fetchGenerationRef.current += 1
    setTodos([])
    todosRef.current = []
    lastSavedSnapshotRef.current.clear()
    setLoading(true)
  }, [clinicId])

  useEffect(() => {
    if (!clinicId) return
    fetchTodos().then(() => {
      setStructureVersion((v) => v + 1)
    })
  }, [clinicId, fetchTodos])

  const saveTodos = useCallback(async (todosToSave: TodoItem[]) => {
    if (!clinicId || !userProfile) return

    const normalizeSnap = (t: TodoItem) => ({
      display_id: (t.display_id && t.display_id !== 'null') ? t.display_id : null,
      issue: (t.issue && t.issue !== 'null') ? t.issue : null,
      notes: (t.notes && t.notes !== 'null') ? t.notes : null,
      followup_notes: (t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : null,
      status: (t.status === 'Open' || !t.status) ? '' : t.status,
    })

    // A row counts as data if the user filled in any free-form field OR set a real status.
    // Status-only rows used to be skipped here, so marking New/Waiting/Complete with no Issue
    // never inserted — the row vanished on refresh (reported as random item loss).
    const hasMeaningfulData = (t: TodoItem) => {
      const status = (t.status && t.status !== 'Open') ? t.status : ''
      return !!(t.display_id || t.issue || t.notes || t.followup_notes || status)
    }

    const seenIds = new Set<string>()
    const todosToProcess = todosToSave.filter((t) => {
      if (!hasMeaningfulData(t)) return false
      if (t.id.startsWith('new-') || t.id.startsWith('empty-')) {
        if (seenIds.has(t.id)) return false
        seenIds.add(t.id)
        return true
      }
      const snap = lastSavedSnapshotRef.current.get(t.id)
      const cur = normalizeSnap(t)
      if (!snap) return true
      return snap.display_id !== cur.display_id || snap.issue !== cur.issue || snap.notes !== cur.notes || snap.followup_notes !== cur.followup_notes || snap.status !== cur.status
    })

    if (todosToProcess.length === 0) {
      saveTriggeredByRowLeaveRef.current = false
      return
    }

    const auditSource = saveTriggeredByRowLeaveRef.current ? 'row-leave-or-flush' : 'typing-debounced-or-direct'
    saveInProgressRef.current = true
    let resolveSaveComplete!: () => void
    const saveCompletePromise = new Promise<void>((r) => {
      resolveSaveComplete = r
    })
    saveCompletePromiseRef.current = { promise: saveCompletePromise, resolve: resolveSaveComplete }
    const auditStartedMs = Date.now()
    let auditSuccess = false
    let auditError: string | null = null
    const auditInserts = todosToProcess.filter((t) => t.id.startsWith('empty-') || t.id.startsWith('new-')).length
    const auditUpdates = todosToProcess.length - auditInserts

    try {
      const savedTodosMap = new Map<string, TodoItem>()

      for (let i = 0; i < todosToProcess.length; i++) {
        const todo = todosToProcess[i]
        const oldId = todo.id
        const statusValue = (todo.status === 'Open' || !todo.status) ? '' : todo.status
        const todoData: Record<string, unknown> = {
          clinic_id: clinicId,
          display_id: (todo.display_id && todo.display_id !== 'null') ? todo.display_id : null,
          issue: (todo.issue && todo.issue !== 'null') ? todo.issue : null,
          status: statusValue,
          notes: (todo.notes && todo.notes !== 'null') ? todo.notes : null,
          followup_notes: (todo.followup_notes && todo.followup_notes !== 'null') ? todo.followup_notes : null,
          updated_at: new Date().toISOString(),
        }

        let savedTodo: TodoItem | null = null

        if (!todo.id.startsWith('new-') && !todo.id.startsWith('empty-')) {
          const { error: updateError, data: updateData } = await apiClient
            .from('todo_lists')
            .update(todoData)
            .eq('id', todo.id)
            .select()

          if (updateError) {
            console.error('[saveTodos] Error updating todo:', updateError)
            if (updateError.message?.includes('relation') || updateError.message?.includes('does not exist')) {
              throw new Error('todo_lists table does not exist. Please run the migration SQL on the database.')
            }
            throw updateError
          }

          if (updateData && updateData.length > 0) {
            savedTodo = normalizeTodoRow(updateData[0] as TodoItem)
            savedTodosMap.set(oldId, savedTodo)
            lastSavedSnapshotRef.current.set(savedTodo.id, normalizeSnap(savedTodo))
            continue
          }
          continue
        }

        const todoInsertData = { ...todoData, created_by: userProfile.id }
        const { error: insertError, data: insertedTodo } = await apiClient
          .from('todo_lists')
          .insert(todoInsertData)
          .select()
          .maybeSingle()

        if (insertError) {
          console.error('[saveTodos] Error inserting todo:', insertError, todoData)
          if (insertError.message?.includes('relation') || insertError.message?.includes('does not exist')) {
            throw new Error('todo_lists table does not exist. Please run the migration SQL on the database.')
          }
          throw insertError
        }

        if (insertedTodo) {
          savedTodo = normalizeTodoRow(insertedTodo as TodoItem)
          savedTodosMap.set(oldId, savedTodo)
          lastSavedSnapshotRef.current.set(savedTodo.id, normalizeSnap(savedTodo))
          if (oldId !== savedTodo.id) {
            lastSavedSnapshotRef.current.delete(oldId)
          }
        }
      }

      setTodos((currentTodos) => {
        const byNewId = new Map<string, TodoItem>()
        savedTodosMap.forEach((saved, oldId) => {
          byNewId.set(saved.id, saved)
          if (oldId !== saved.id) byNewId.set(oldId, saved)
        })
        const merged = currentTodos.map((todo) => {
          const savedTodo = savedTodosMap.get(todo.id) ?? byNewId.get(todo.id)
          if (savedTodo) {
            const normalized = normalizeTodoRow(savedTodo)
            return {
              ...todo,
              id: normalized.id,
              created_at: normalized.created_at,
              updated_at: normalized.updated_at,
              clinic_id: normalized.clinic_id,
              created_by: normalized.created_by,
              completed_at: normalized.completed_at,
              display_id: todo.display_id !== undefined ? todo.display_id : normalized.display_id,
              issue: todo.issue !== undefined ? todo.issue : normalized.issue,
              notes: todo.notes !== undefined ? todo.notes : normalized.notes,
              followup_notes: todo.followup_notes !== undefined ? todo.followup_notes : normalized.followup_notes,
              status: todo.status !== undefined ? todo.status : normalized.status,
            }
          }
          return todo
        })
        return sortBillingTodosCompleteAtBottom(merged)
      })

      saveTriggeredByRowLeaveRef.current = false
      auditSuccess = true
    } catch (error) {
      console.error('[saveTodos] Error saving todos:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      auditError = errorMessage
      if (
        !errorMessage.includes('todo_lists table does not exist') &&
        !errorMessage.includes('relation') &&
        !errorMessage.includes('does not exist')
      ) {
        alert(errorMessage || 'Failed to save todo. Please try again.')
      }
    } finally {
      void recordSaveAudit({
        sheetKind: 'billing_todo',
        clinicId,
        source: auditSource,
        rowCount: todosToProcess.length,
        elapsedMs: Date.now() - auditStartedMs,
        success: auditSuccess,
        errorMessage: auditError,
        actions: { inserts: auditInserts, updates: auditUpdates },
      })
      saveInProgressRef.current = false
      saveCompletePromiseRef.current?.resolve()
      saveCompletePromiseRef.current = null
      if (savePendingRef.current) {
        savePendingRef.current = false
        setRunPendingSaveTrigger((t) => t + 1)
      }
    }
  }, [clinicId, userProfile, createEmptyTodo, normalizeTodoRow, sortBillingTodosCompleteAtBottom])

  saveTodosRef.current = saveTodos

  useEffect(() => {
    if (runPendingSaveTrigger === 0) return
    saveTodosRef.current(todosRef.current).catch((err) => {
      console.error('[BillingTodoTab] Error in pending save:', err)
    })
  }, [runPendingSaveTrigger])

  // Register flush for parent tab switch (same sequence as PatientsTab)
  useEffect(() => {
    if (!onRegisterFlushBeforeTabLeave) return
    const flush = async () => {
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
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

      if (saveTodosTimeoutRef.current) {
        clearTimeout(saveTodosTimeoutRef.current)
        saveTodosTimeoutRef.current = null
      }
      if (saveInProgressRef.current && saveCompletePromiseRef.current) {
        await saveCompletePromiseRef.current.promise
      }
      saveTriggeredByRowLeaveRef.current = true
      await saveTodos(todosRef.current)
    }
    onRegisterFlushBeforeTabLeave(flush)
  }, [onRegisterFlushBeforeTabLeave, saveTodos])

  // Best-effort flush on unmount (e.g. route away); ref always points to latest saveTodos
  useEffect(() => {
    return () => {
      if (saveTodosTimeoutRef.current) {
        clearTimeout(saveTodosTimeoutRef.current)
        saveTodosTimeoutRef.current = null
      }
      void saveTodosRef.current(todosRef.current)?.catch((err: unknown) => {
        console.error('[BillingTodoTab unmount] Error flushing save:', err)
      })
    }
  }, [])

  const handleDeleteTodo = useCallback(
    async (todoId: string) => {
      if (todoId.startsWith('new-')) {
        setTodos((prev) => prev.filter((t) => t.id !== todoId))
        setStructureVersion((v) => v + 1)
        return
      }

      try {
        const { error } = await apiClient.from('todo_lists').delete().eq('id', todoId)
        if (error) throw error
        await fetchTodos()
        setStructureVersion((v) => v + 1)
        if (onDelete) onDelete(todoId)
      } catch (error) {
        console.error('Error deleting todo:', error)
        alert(`Failed to delete to-do item: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    },
    [fetchTodos, onDelete]
  )

  // Re-pad whenever the user clicks "Add 50 rows". Without this effect, padBillingTodosTo200 only
  // ran from event handlers (add/delete row), so incrementing extraEmptyRows had no visible effect
  // until the user happened to trigger one of those. The structureVersion bump pushes the new
  // (longer) data array to the grid.
  useEffect(() => {
    if (extraEmptyRows === 0) return
    setTodos((prev) => padBillingTodosTo200(prev))
    setStructureVersion((v) => v + 1)
  }, [extraEmptyRows, padBillingTodosTo200])

  const syncTodosFromHotAfterUndoRedo = useCallback(() => {
    const hot = hotRef.current
    if (!hot || (hot as any).isDestroyed) return
    if (!canEdit) return
    try {
      const grid = hot.getData() as (string | number | null | undefined)[][]
      // HOT's grid rows correspond to the visible slice (current or archive). Merge those rows
      // back onto the items they came from (looked up by id), and leave items in the *other*
      // slice untouched. Iterating `prev` by raw index here would smear archive data onto
      // current items (or vice versa).
      const prev = todosRef.current
      const visible = prev.filter((t) =>
        viewMode === 'archive' ? t.status === 'Complete' : t.status !== 'Complete'
      )
      const merged = new Map<string, TodoItem>()
      for (let i = 0; i < grid.length && i < visible.length; i++) {
        const row = grid[i]
        const source = visible[i]
        if (!source) continue
        merged.set(source.id, mergeBillingTodoFromGridRow(source, row))
      }
      const next = prev.map((t) => merged.get(t.id) ?? t)
      const padded = padBillingTodosTo200(next)
      todosRef.current = padded
      setTodos(padded)
      void saveTodos(padded).catch((err) => console.error('saveTodos after HOT undo/redo sync', err))
    } catch (e) {
      console.error('syncTodosFromHotAfterUndoRedo', e)
    }
  }, [canEdit, padBillingTodosTo200, saveTodos, viewMode])

  const handleAfterCreateRow = useCallback(
    (index: number, amount: number, source?: string) => {
      if (!canEdit) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      setTodos((prev) => {
        const next = [...prev]
        const base = nextEmptyNumericIdSuffix(next)
        for (let i = 0; i < amount; i++) {
          next.splice(index + i, 0, createEmptyTodo(base + i))
        }
        const padded = padBillingTodosTo200(next)
        todosRef.current = padded
        return padded
      })
      setStructureVersion((v) => v + 1)
      requestAnimationFrame(() => {
        saveTodos(todosRef.current).catch((err) => console.error('saveTodos after HOT create row', err))
      })
    },
    [canEdit, createEmptyTodo, padBillingTodosTo200, saveTodos]
  )

  const handleAfterRemoveRow = useCallback(
    (_index: number, _amount: number, physicalRows: number[], source?: string) => {
      if (!canEdit) return
      if (source === 'loadData' || source === 'updateData') return
      if (isHandsontableUndoRedoSource(source)) return
      // `physicalRows` from HOT are indices into the *visible* slice (current or archive), not
      // into the underlying `todos` array. Translate to ids first so we delete the right items
      // regardless of which view the user is in.
      const snap = [...todosRef.current]
      const visibleSnap = snap.filter((t) =>
        viewMode === 'archive' ? t.status === 'Complete' : t.status !== 'Complete'
      )
      const removedIds = physicalRows
        .map((vi) => visibleSnap[vi]?.id)
        .filter((id): id is string => Boolean(id))
      const removed = removedIds
        .map((id) => snap.find((t) => t.id === id))
        .filter((t): t is TodoItem => Boolean(t))
      removed.forEach((t) => {
        if (t.id.startsWith('empty-')) return
        void handleDeleteTodo(t.id)
      })
      setTodos((prev) => {
        const rmIds = new Set(removedIds)
        const next = prev.filter((t) => !rmIds.has(t.id))
        const sorted = sortBillingTodosCompleteAtBottom(next)
        const padded = padBillingTodosTo200(sorted)
        todosRef.current = padded
        return padded
      })
      setStructureVersion((v) => v + 1)
      requestAnimationFrame(() => {
        saveTodos(todosRef.current).catch((err) => console.error('saveTodos after HOT remove row', err))
      })
    },
    [canEdit, handleDeleteTodo, padBillingTodosTo200, saveTodos, sortBillingTodosCompleteAtBottom, viewMode]
  )

  // Export todos to CSV (only rows with at least one value)
  const exportToCsv = useCallback(() => {
    const headers = ['ID', 'Status', 'Issue', 'Notes', 'F/u notes']
    const escapeCsv = (val: string): string => {
      const s = String(val ?? '')
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }
    const rowsWithData = todos.filter(t => t.display_id || t.issue || t.status || t.notes || t.followup_notes)
    const statusDisplay = (s: string | null) => (s && s !== 'Open') ? s : ''
    const csvRows = [
      headers.join(','),
      ...rowsWithData.map(t => [
        escapeCsv((t.display_id && t.display_id !== 'null') ? t.display_id : ''),
        escapeCsv(statusDisplay(t.status || '')),
        escapeCsv((t.issue && t.issue !== 'null') ? t.issue : ''),
        escapeCsv((t.notes && t.notes !== 'null') ? t.notes : ''),
        escapeCsv((t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : ''),
      ].join(',')),
    ]
    // Prefix BOM (﻿) so Excel opens as UTF-8 and never falls into legacy SYLK detection
    // (which fires when the first two bytes are exactly "ID" and pops up "file is corrupted").
    const csv = '﻿' + csvRows.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `billing-todo-${clinicId}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [todos, clinicId])

  // Expose export to parent for header (single view and split screen)
  useEffect(() => {
    if (exportRef) {
      exportRef.current = { exportToCSV: exportToCsv }
      return () => {
        exportRef.current = null
      }
    }
  }, [exportRef, exportToCsv])

  // Status color mapping (five statuses: New, Waiting, In Progress, Complete, Updated)
  const getStatusColor = useCallback((status: string): { color: string; textColor: string } | null => {
    switch (status) {
      case 'New':
        return { color: '#53d5fd', textColor: '#ffffff' }
      case 'Waiting':
        return { color: '#ff6251', textColor: '#ffffff' }
      case 'In Progress':
        return { color: '#b18cfe', textColor: '#ffffff' }
      case 'Updated':
        return { color: '#fff76b', textColor: '#000' }
      case 'Complete':
        return { color: '#96d35f', textColor: '#33895f' }
      default:
        return null
    }
  }, [])

  // Reorder todos when user drags a row by the row header; persist order via created_at so reload preserves it.
  // The `movedRows` / `finalIndex` HOT hands us are indices into the currently *visible* slice
  // (current or archive view), not into the full `todos` array. We translate them by ID before
  // splicing — otherwise dragging row 3 in archive mode would move whatever happens to be
  // todos[3] (likely an incomplete item from current view).
  const handleTodosRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    setTodos((prev) => {
      // Snapshot the visible slice exactly as HOT sees it.
      const visible = prev.filter((t) =>
        viewMode === 'archive' ? t.status === 'Complete' : t.status !== 'Complete'
      )
      const movedIds = movedRows
        .map((vi) => visible[vi]?.id)
        .filter((id): id is string => Boolean(id))
      if (movedIds.length === 0) return prev
      // Drop-target id is whatever currently sits at finalIndex in the visible list (or end-of-list).
      const targetId = visible[finalIndex]?.id ?? null

      const movedIdSet = new Set(movedIds)
      const remaining = prev.filter((t) => !movedIdSet.has(t.id))
      const movedItems = movedIds
        .map((id) => prev.find((t) => t.id === id))
        .filter((t): t is TodoItem => Boolean(t))

      // Insert before the target item in the full list, or at the end if no target.
      let insertAt = targetId ? remaining.findIndex((t) => t.id === targetId) : remaining.length
      if (insertAt < 0) insertAt = remaining.length
      remaining.splice(insertAt, 0, ...movedItems)
      const next = sortBillingTodosCompleteAtBottom(remaining)

      const realTodos = next.filter((t) => !t.id.startsWith('empty-') && !t.id.startsWith('new-'))
      if (realTodos.length > 0) {
        const baseTime = Date.now()
        Promise.all(
          realTodos.map((todo, i) =>
            apiClient
              .from('todo_lists')
              .update({ created_at: new Date(baseTime - i * 1000).toISOString() })
              .eq('id', todo.id)
          )
        ).catch((err) => console.error('Failed to persist todo order', err))
      }
      return next
    })
    setStructureVersion((v) => v + 1)
  }, [sortBillingTodosCompleteAtBottom, viewMode])

  // Archive feature: the table only ever renders one slice of `todos` at a time. Current view
  // shows non-Complete rows plus the empty placeholders that let users type new entries. Archive
  // view shows only the Complete rows (no placeholders — there's nothing to add to history).
  // `todos` itself stays the full source of truth, so saves, undo/redo, lock data, etc. all keep
  // working unchanged. We only need to map HOT's visual row indices back to the physical index
  // in `todos` whenever a callback wants to mutate a specific row.
  const displayedTodos = useMemo(() => {
    if (viewMode === 'archive') {
      return todos.filter((t) => t.status === 'Complete')
    }
    // Current: anything that isn't Complete is visible, including empty placeholders so the
    // grid still has its 200-row scratch space for new entries.
    return todos.filter((t) => t.status !== 'Complete')
  }, [todos, viewMode])

  // Convert todos to Handsontable data format. Uses `displayedTodos` so the grid shows only
  // Current rows or only Archive rows depending on the active tab.
  const getTodosHandsontableData = useCallback(() => {
    return displayedTodos.map(todo => [
      // User-entered identifier (display_id); independent of the row UUID. Empty until filled in.
      (todo.display_id && todo.display_id !== 'null') ? todo.display_id : '',
      // No "Open" status; when no value or legacy "Open", show empty cell
      (todo.status && todo.status !== 'Open') ? todo.status : '',
      (todo.issue && todo.issue !== 'null') ? todo.issue : '',
      (todo.notes && todo.notes !== 'null') ? todo.notes : '',
      (todo.followup_notes && todo.followup_notes !== 'null') ? todo.followup_notes : '',
    ])
  }, [displayedTodos])

  // Column field names mapping to is_lock_billing_todo table columns
  const columnFields: Array<keyof IsLockBillingTodo> = ['id_column', 'status', 'issue', 'notes', 'followup_notes']
  const columnTitles = ['ID', 'Status', 'Issue', 'Notes', 'F/u notes']

  const todosCellsCallback = useCallback(
    (row: number, col: number) => {
      const todo = displayedTodos[row]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${todo?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key) ? { className: 'cell-highlight-yellow' } : {}
    },
    [displayedTodos, columnFields, highlightedCells]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const todo = displayedTodos[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${todo?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [displayedTodos, columnFields, highlightedCells]
  )

  const handleCellHighlight = useCallback((row: number, col: number) => {
    const todo = displayedTodos[row]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${todo?.id ?? `row-${row}`}:${colKey}`
    setHighlightedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [displayedTodos, columnFields])

  // Right-click on column headers to lock/unlock (no lock icon in header)
  useEffect(() => {
    if (!canEdit || !onLockColumn || !isColumnLocked) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let menuEl: HTMLElement | null = null
    let closeListener: (() => void) | null = null

    const hideMenu = () => {
      if (menuEl?.parentNode) menuEl.parentNode.removeChild(menuEl)
      menuEl = null
      if (closeListener) {
        document.removeEventListener('click', closeListener)
        document.removeEventListener('contextmenu', closeListener)
        closeListener = null
      }
    }

    const showHeaderContextMenu = (e: MouseEvent, columnName: string) => {
      e.preventDefault()
      e.stopPropagation()
      hideMenu()
      const isLocked = isColumnLocked ? isColumnLocked(columnName as keyof IsLockBillingTodo) : false
      const menu = document.createElement('div')
      menu.className = 'billing-todo-col-header-context-menu'
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
      const x = Math.min(e.clientX, window.innerWidth - 150)
      const y = Math.min(e.clientY, window.innerHeight - 40)
      menu.style.left = `${x}px`
      menu.style.top = `${y}px`
      closeListener = () => { hideMenu() }
      setTimeout(() => {
        document.addEventListener('click', closeListener!, true)
        document.addEventListener('contextmenu', closeListener!, true)
      }, 0)
    }

    const attachContextMenuToHeader = (headerRow: Element | null) => {
      if (!headerRow) return
      const headerCells = Array.from(headerRow.querySelectorAll('th'))
      headerCells.forEach((th) => {
        const colHeader = th.querySelector('.colHeader')
        let cellText = (colHeader?.textContent ?? th.textContent ?? '').replace(/🔒|🔓/g, '').trim()
        const columnIndex = columnTitles.findIndex(title => {
          const a = title.toLowerCase().trim()
          const b = cellText.toLowerCase().trim()
          return a === b || b.includes(a) || a.includes(b)
        })
        if (columnIndex === -1 || columnIndex >= columnFields.length) return
        const columnName = columnFields[columnIndex]
        const el = th as HTMLElement
        const prev = (el as any)._billingTodoHeaderContext
        if (prev) el.removeEventListener('contextmenu', prev)
        const handler = (e: MouseEvent) => showHeaderContextMenu(e, columnName as string)
        ;(el as any)._billingTodoHeaderContext = handler
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
        const h = (th as any)._billingTodoHeaderContext
        if (h) th.removeEventListener('contextmenu', h)
      })
    }
  }, [canEdit, onLockColumn, isColumnLocked, columnFields, columnTitles, isLockBillingTodo])

  const getReadOnly = (columnName: keyof IsLockBillingTodo): boolean => {
    if (!canEdit) return true
    if (!lockData) return false
    return Boolean(lockData[columnName])
  }

  // Create columns with custom renderers; only ID and Status are sortable (Issue, Notes, F/u notes have headerAction: false)
  const todosColumns = useMemo(() => [
    {
      data: 0,
      title: 'ID',
      type: 'text' as const,
      width: 80,
      readOnly: !canEdit || getReadOnly('id_column'),
      columnSorting: { indicator: true },
    },
    {
      data: 1,
      title: 'Status',
      type: 'dropdown' as const,
      width: 120,
      selectOptions: ['New', 'Waiting', 'In Progress', 'Complete', 'Updated'],
      allowEmpty: false,
      renderer: createBubbleDropdownRenderer(getStatusColor) as any,
      editor: createColoredAutocompleteDropdown(getStatusColor),
      readOnly: !canEdit || getReadOnly('status'),
      columnSorting: { headerAction: false },
    },
    {
      data: 2,
      title: 'Issue',
      type: 'text' as const,
      width: 200,
      // wordWrap + grid-level autoRowSize lets long Issue/Notes/F-u notes wrap across multiple lines.
      // Without autoRowSize, wrapped text would be clipped at the default 24px row height.
      wordWrap: true,
      readOnly: !canEdit || getReadOnly('issue'),
      columnSorting: { headerAction: false },
    },
    {
      data: 3,
      title: 'Notes',
      type: 'text' as const,
      width: 200,
      wordWrap: true,
      readOnly: !canEdit || getReadOnly('notes'),
      columnSorting: { headerAction: false },
    },
    {
      data: 4,
      title: 'F/u notes',
      type: 'text' as const,
      width: 200,
      wordWrap: true,
      readOnly: !canEdit || getReadOnly('followup_notes'),
      columnSorting: { headerAction: false },
    },
  ], [canEdit, lockData, getStatusColor])

  const handleTodosHandsontableChange = useCallback(
    (changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
      if (!changes || source === 'loadData') return

      const currentTodos = todosRef.current.length > 0 ? todosRef.current : todos
      const updatedTodos = [...currentTodos]
      const fields: Array<'display_id' | 'status' | 'issue' | 'notes' | 'followup_notes'> = [
        'display_id',
        'status',
        'issue',
        'notes',
        'followup_notes',
      ]

      // HOT's row index is visual when column sorting is on. Map visual → physical within the
      // *displayed* slice (current vs. archive), then to the full `todos` array by id.
      const visibleSnapshot = updatedTodos.filter((t) =>
        viewMode === 'archive' ? t.status === 'Complete' : t.status !== 'Complete'
      )
      const resolvePhysical = (hotRow: number): number => {
        const visualInDisplayed = physicalRowFromHot(typeof hotRow === 'number' ? hotRow : 0)
        const visible = visibleSnapshot[visualInDisplayed]
        if (visible) {
          const idx = updatedTodos.findIndex((t) => t.id === visible.id)
          if (idx >= 0) return idx
        }
        // Fall back to extending the array for empty-row creation (only meaningful in current view
        // where placeholders are allowed). Archive view shouldn't be appending rows.
        if (viewMode === 'current') {
          while (updatedTodos.length <= visualInDisplayed) {
            updatedTodos.push(createEmptyTodo(nextEmptyNumericIdSuffix(updatedTodos)))
          }
          return visualInDisplayed
        }
        return -1
      }

      const rowsInChange = [...new Set(changes.map(([r]) => physicalRowFromHot(typeof r === 'number' ? r : 0)))]
      const primaryRow = rowsInChange[0] ?? null
      const prevRow = lastEditedRowRef.current
      const didLeaveRow = prevRow !== null && primaryRow !== null && !rowsInChange.includes(prevRow)

      // Track which physical indices had a status change for the post-edit sort step.
      const statusChangePhysical: Array<{ phys: number; oldVal: unknown; newVal: unknown }> = []

      changes.forEach(([row, col, oldValue, newValue]) => {
        const phys = resolvePhysical(typeof row === 'number' ? row : 0)
        if (phys < 0) return
        const todo = updatedTodos[phys]
        if (!todo) return
        const field = fields[col as number]
        if (field === 'display_id') {
          const displayIdVal = newValue === '' || newValue == null || newValue === 'null' ? null : String(newValue)
          updatedTodos[phys] = { ...todo, display_id: displayIdVal, updated_at: new Date().toISOString() }
        } else if (field === 'status') {
          updatedTodos[phys] = { ...todo, status: String(newValue || ''), updated_at: new Date().toISOString() }
          statusChangePhysical.push({ phys, oldVal: oldValue, newVal: newValue })
        } else if (field === 'issue') {
          const issueVal = newValue === '' || newValue === 'null' ? null : String(newValue)
          updatedTodos[phys] = { ...todo, issue: issueVal, updated_at: new Date().toISOString() }
        } else if (field === 'notes') {
          const notesVal = newValue === '' || newValue === 'null' ? null : String(newValue)
          updatedTodos[phys] = { ...todo, notes: notesVal, updated_at: new Date().toISOString() }
        } else if (field === 'followup_notes') {
          const followupVal = newValue === '' || newValue === 'null' ? null : String(newValue)
          updatedTodos[phys] = { ...todo, followup_notes: followupVal, updated_at: new Date().toISOString() }
        }
      })

      const statusChanged = statusChangePhysical.length > 0
      if (statusChanged) {
        const dataRows = updatedTodos.filter((t) => !isBillingTodoEmptyPlaceholder(t))
        let incomplete = dataRows.filter((t) => t.status !== 'Complete')
        const complete = dataRows.filter((t) => t.status === 'Complete')
        const emptyRows = updatedTodos.filter((t) => isBillingTodoEmptyPlaceholder(t))
        const movedToTopIds = new Set<string>()
        statusChangePhysical.forEach(({ phys, oldVal, newVal }) => {
          if (oldVal === 'Complete' && newVal !== 'Complete' && phys < updatedTodos.length) {
            movedToTopIds.add(updatedTodos[phys].id)
          }
        })
        if (movedToTopIds.size > 0) {
          incomplete = [
            ...incomplete.filter((t) => movedToTopIds.has(t.id)),
            ...incomplete.filter((t) => !movedToTopIds.has(t.id)),
          ]
        }
        const reordered = [...incomplete, ...complete, ...emptyRows]
        while (reordered.length < updatedTodos.length) {
          reordered.push(createEmptyTodo(nextEmptyNumericIdSuffix(reordered)))
        }
        if (reordered.length > updatedTodos.length) {
          reordered.length = updatedTodos.length
        }
        updatedTodos.length = 0
        updatedTodos.push(...reordered)
      }

      // Never hard-truncate to 200 — that dropped real rows after "Add 50 rows" or when
      // Current+Archive exceeded 200 (Jenali/Silvercrest data-loss). Pad only (same as PatientsTab).
      const paddedTodos = padBillingTodosTo200(updatedTodos)
      updatedTodos.length = 0
      updatedTodos.push(...paddedTodos)

      lastEditedRowRef.current = primaryRow
      if (primaryRow !== null) lastSelectedRowRef.current = primaryRow

      todosRef.current = updatedTodos
      setTodos(updatedTodos)
      if (statusChanged) {
        setStructureVersion((v) => v + 1)
      }

      if (didLeaveRow) {
        saveTriggeredByRowLeaveRef.current = true
        if (saveTodosTimeoutRef.current) {
          clearTimeout(saveTodosTimeoutRef.current)
          saveTodosTimeoutRef.current = null
        }
        if (!saveInProgressRef.current) {
          saveTodos(todosRef.current).catch((err) =>
            console.error('[BillingTodo→] Error flushing save on row leave:', err)
          )
        } else {
          savePendingRef.current = true
        }
      }

      if (pendingRowLeaveSaveRef.current) {
        pendingRowLeaveSaveRef.current = false
        if (pendingRowLeaveSaveTimeoutRef.current) {
          clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
          pendingRowLeaveSaveTimeoutRef.current = null
        }
        saveTriggeredByRowLeaveRef.current = true
        if (saveTodosTimeoutRef.current) {
          clearTimeout(saveTodosTimeoutRef.current)
          saveTodosTimeoutRef.current = null
        }
        if (!saveInProgressRef.current) {
          saveTodos(todosRef.current).catch((err) =>
            console.error('[BillingTodo→] Error flushing save (pending row leave):', err)
          )
        } else {
          savePendingRef.current = true
        }
      }

      // Include display_id (col 0) — ID-only rows must still debounce-save.
      const hasMeaningfulChange = changes.some(([, col]) => col === 0 || col === 1 || col === 2 || col === 3 || col === 4)
      if (!hasMeaningfulChange) return

      if (saveTodosTimeoutRef.current) clearTimeout(saveTodosTimeoutRef.current)
      saveTodosTimeoutRef.current = setTimeout(() => {
        saveTodosTimeoutRef.current = null
        if (saveInProgressRef.current) {
          savePendingRef.current = true
          return
        }
        saveTodos(todosRef.current).catch((err) => {
          console.error('[handleTodosHandsontableChange] Error in saveTodos:', err)
        })
      }, 500)
    },
    [saveTodos, createEmptyTodo, todos, isBillingTodoEmptyPlaceholder, viewMode, physicalRowFromHot, padBillingTodosTo200]
  )

  const handleAfterSelection = useCallback(
    (r: number, _c: number, _r2: number, _c2: number) => {
      const physR = physicalRowFromHot(r)
      const prev = lastSelectedRowRef.current
      if (prev !== null && physR !== prev) {
        if (saveInProgressRef.current) {
          savePendingRef.current = true
        } else {
          pendingRowLeaveSaveRef.current = true
          if (pendingRowLeaveSaveTimeoutRef.current) clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
          const FALLBACK_MS = 800
          pendingRowLeaveSaveTimeoutRef.current = setTimeout(() => {
            pendingRowLeaveSaveTimeoutRef.current = null
            if (!pendingRowLeaveSaveRef.current) return
            pendingRowLeaveSaveRef.current = false
            saveTriggeredByRowLeaveRef.current = true
            if (saveTodosTimeoutRef.current) {
              clearTimeout(saveTodosTimeoutRef.current)
              saveTodosTimeoutRef.current = null
            }
            if (saveInProgressRef.current) {
              savePendingRef.current = true
              return
            }
            saveTodos(todosRef.current).catch((err) =>
              console.error('[BillingTodo→] Error flushing save on selection change (fallback):', err)
            )
          }, FALLBACK_MS)
        }
      }
      lastSelectedRowRef.current = physR
    },
    [saveTodos, physicalRowFromHot]
  )

  const handleAfterDeselect = useCallback(() => {
    if (lastSelectedRowRef.current === null) return
    if (pendingRowLeaveSaveTimeoutRef.current) {
      clearTimeout(pendingRowLeaveSaveTimeoutRef.current)
      pendingRowLeaveSaveTimeoutRef.current = null
    }
    pendingRowLeaveSaveRef.current = false
    saveTriggeredByRowLeaveRef.current = true
    if (saveTodosTimeoutRef.current) {
      clearTimeout(saveTodosTimeoutRef.current)
      saveTodosTimeoutRef.current = null
    }
    if (saveInProgressRef.current) {
      savePendingRef.current = true
      return
    }
    saveTodos(todosRef.current).catch((err) =>
      console.error('[BillingTodo→] Error flushing save on deselect (click outside):', err)
    )
  }, [saveTodos])

  // Split mode: compute HOT height from the pane's own clientHeight minus all known siblings,
  // padding, and a hard safety buffer. The flex-based approach (reading container.clientHeight)
  // proved unreliable because the container's flex slot includes the button row's space whenever
  // the row is `shrink-0` but the table is being passed a height that's bigger than the slot —
  // HOT then visually overflows the container, and even though the button is positioned correctly
  // by flex, the visual table sits on top of it. Subtracting from the pane height directly
  // guarantees there's room reserved for the button + margin + bottom padding regardless of
  // anything HOT does internally.
  // Full mode: viewport-based with a generous offset (unchanged).
  useEffect(() => {
    const BUTTON_ROW_TOTAL = 56  // mt-4 (16) + button height (~36) + 4px safety buffer
    const SPLIT_PANE_PADDING = 48  // p-6 top + bottom on .split-pane-tab
    const SPLIT_SAFETY = 8  // extra buffer to keep HOT's horizontal scrollbar from kissing the button
    const FULL_PAGE_BOTTOM_OFFSET = 24
    const FULL_PAGE_TOP_FALLBACK = 220
    const FULL_PAGE_MIN_HEIGHT = 480
    const computeHeight = (): number => {
      const el = tableContainerRef.current
      if (!el) return Math.max(FULL_PAGE_MIN_HEIGHT, window.innerHeight - FULL_PAGE_TOP_FALLBACK)
      if (isInSplitScreen) {
        // Pane = `.split-pane-tab` (the parent of the container). Its clientHeight reflects the
        // pane's *intrinsic* size — but on larger viewports the parent split container can have
        // `minHeight: 650px` which makes the pane taller than the viewport. So we also derive a
        // viewport-relative ceiling from the container's top to the window's bottom, and take the
        // smaller of the two. That way the button stays inside the visible area even when the
        // pane technically extends below the fold.
        const pane = el.parentElement
        const topPx = el.getBoundingClientRect().top
        let paneAvailable = Number.POSITIVE_INFINITY
        if (pane) {
          paneAvailable = pane.clientHeight - SPLIT_PANE_PADDING - BUTTON_ROW_TOTAL - SPLIT_SAFETY
        }
        const viewportAvailable = window.innerHeight - topPx - BUTTON_ROW_TOTAL - SPLIT_SAFETY
        const available = Math.min(paneAvailable, viewportAvailable)
        if (available > 100) return available
        const ch = el.clientHeight
        return ch && ch > 100 ? ch - SPLIT_SAFETY : 400
      }
      const topPx = el.getBoundingClientRect().top
      const available = window.innerHeight - topPx - BUTTON_ROW_TOTAL - FULL_PAGE_BOTTOM_OFFSET
      if (available > 100) return available
      return Math.max(FULL_PAGE_MIN_HEIGHT, window.innerHeight - FULL_PAGE_TOP_FALLBACK)
    }
    const apply = () => setTableHeight(computeHeight())
    requestAnimationFrame(apply)
    const settleTimer = setTimeout(apply, 100)
    const onResize = () => apply()
    window.addEventListener('resize', onResize)
    // Reapply on container size changes too (e.g. split-screen divider drag changes panel width which
    // may affect button row wrap, indirectly affecting available height).
    let ro: ResizeObserver | null = null
    const el = tableContainerRef.current
    if (el) {
      ro = new ResizeObserver(apply)
      ro.observe(el)
      if (el.parentElement) ro.observe(el.parentElement)
    }
    return () => {
      clearTimeout(settleTimer)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [isInSplitScreen])

  // Archive count for the tab badge — shows how many items are sitting in the archive view.
  // Must be declared before the `if (loading) return` early-exit below, otherwise the hook order
  // changes between the loading and loaded renders and React throws error #310 ("Rendered more
  // hooks than during the previous render").
  const archiveCount = useMemo(
    () => todos.filter((t) => t.status === 'Complete').length,
    [todos]
  )

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-white/70 py-8">Loading to-do items...</div>
      </div>
    )
  }

  return (
    <div className={isInSplitScreen ? 'p-6 split-pane-tab' : 'p-6'}>
      {/* Current / Archive / Notes tabs. Items marked Complete move from Current to Archive
          automatically since both views are derived from the same `todos` list via status filter.
          Notes is a separate freeform notepad (per clinic) stored in `billing_todo_notes`. */}
      <div className="mb-3 flex items-center gap-2 shrink-0">
        {(['current', 'archive', 'notes'] as const).map((mode) => {
          const active = viewMode === mode
          const label = mode === 'current' ? 'Current' : mode === 'archive' ? 'Archive' : 'Notes'
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={active}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors border ${
                active
                  ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                  : 'bg-white/5 text-white/80 border-white/20 hover:bg-white/10 hover:text-white'
              }`}
            >
              {label}
              {mode === 'archive' && archiveCount > 0 && (
                <span className={`ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs font-semibold ${active ? 'bg-white/20 text-white' : 'bg-white/15 text-white/80'}`}>
                  {archiveCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {viewMode === 'notes' ? (
        <BillingTodoNotes clinicId={clinicId} canEdit={canEdit} />
      ) : (
      <div
        ref={tableContainerRef}
        className={`table-container dark-theme ${isInSplitScreen ? 'min-w-0 flex-1' : ''}`}
        style={{
          // Container fills its parent in both modes. The grey backplate that used to sit under
          // the rows came from a hardcoded 600px maxHeight + non-transparent `#d2dbe5` bg; both
          // are removed so the table itself defines visible bounds and the dark theme shows through.
          flex: 1,
          minHeight: 0,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          width: '100%',
          maxWidth: '100%',
          borderRadius: '8px',
          backgroundColor: 'transparent',
        }}
      >
        <HandsontableWrapper
          // Include viewMode in the key so HOT fully re-initializes when the user switches tabs.
          // Without this the visible data updates but HOT's internal row metadata (selection,
          // column sort state) holds onto indices from the previous view and renders oddly.
          key={`todos-${clinicId}-${isInSplitScreen ? 'split' : 'full'}-${viewMode}`}
          hotInstanceRef={hotRef}
          data={getTodosHandsontableData()}
          dataVersion={structureVersion}
          columns={todosColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={tableHeight}
          // Auto-size rows so wordWrap on Issue / Notes / F-u notes actually shows wrapped text.
          autoRowSize={{ syncLimit: 200 }}
          // Stretch the last column to absorb leftover width when the pane is wider than the
          // columns' natural widths — without this the wtHolder's #d2dbe5 fill shows as a blank
          // vertical band to the right of F/u notes. Handsontable still produces a horizontal
          // scrollbar when columns overflow the pane width, so this is safe in narrow panes too.
          stretchH={isInSplitScreen ? "last" : "all"}
          afterChange={handleTodosHandsontableChange}
          afterSelection={handleAfterSelection}
          afterDeselect={handleAfterDeselect}
          onAfterRowMove={handleTodosRowMove}
          afterCreateRow={handleAfterCreateRow}
          afterRemoveRow={handleAfterRemoveRow}
          onAfterUndoRedoSync={syncTodosFromHotAfterUndoRedo}
          contextMenuWithNativeRows
          onCellHighlight={handleCellHighlight}
          getCellIsHighlighted={getCellIsHighlighted}
          cells={todosCellsCallback}
          enableFormula={true}
          columnSorting={{ indicator: true }}
          readOnly={!canEdit}
          style={{ backgroundColor: '#d2dbe5' }}
          className="handsontable-custom billing-todo-sortable"
        />
      </div>
      )}
      {canEdit && viewMode === 'current' && (
        // Only render in Current view — Archive is read-history; adding empty placeholder rows
        // there would be pointless (they aren't Complete and wouldn't show up in the archive
        // filter anyway).
        // `shrink-0` keeps this row at its natural height inside the flex column so the
        // table-container (flex: 1) shrinks to make room rather than the button getting squeezed
        // out. `relative` + z-index sits above Handsontable's `ht_clone_top` (z: 10) and clone
        // wrappers, so even if the table visually overflows in split mode, the button still wins.
        // `mt-4` (instead of `mt-3`) gives the button enough visual breathing room from the
        // table's bottom edge in split mode where it sits directly under the wtHolder scrollbar.
        <div
          className="mt-4 flex items-center justify-end gap-3 shrink-0 relative"
          style={{ zIndex: 20 }}
        >
          <button
            type="button"
            onClick={() => setExtraEmptyRows((n) => n + BILLING_TODOS_ROWS_STEP)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-medium"
          >
            <span aria-hidden="true">+</span> Add {BILLING_TODOS_ROWS_STEP} rows
          </button>
        </div>
      )}
    </div>
  )
}
