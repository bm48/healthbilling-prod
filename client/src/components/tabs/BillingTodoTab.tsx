import { useState, useEffect, useCallback, useRef, useMemo, type MutableRefObject } from 'react'
import { apiClient } from '@/lib/apiClient'
import { TodoItem, IsLockBillingTodo } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import HandsontableWrapper from '@/components/HandsontableWrapper'
import Handsontable from 'handsontable'
import { createBubbleDropdownRenderer } from '@/lib/handsontableCustomRenderers'

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
  const lastSavedSnapshotRef = useRef<Map<string, { issue: string | null; notes: string | null; followup_notes: string | null; status: string }>>(new Map())
  const lastEditedRowRef = useRef<number | null>(null)
  const saveTriggeredByRowLeaveRef = useRef(false)
  const lastSelectedRowRef = useRef<number | null>(null)
  const pendingRowLeaveSaveRef = useRef(false)
  const pendingRowLeaveSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const [tableHeight, setTableHeight] = useState(600)
  const [structureVersion, setStructureVersion] = useState(0) // Bump on add/delete row so grid refreshes immediately
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set())

  // Use isLockBillingTodo from props directly - it will update when parent refreshes
  const lockData = isLockBillingTodo || null

  const createEmptyTodo = useCallback((index: number): TodoItem => ({
    id: `empty-${index}`,
    clinic_id: clinicId,
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
    issue: (t.issue && t.issue !== 'null') ? t.issue : null,
    notes: (t.notes && t.notes !== 'null') ? t.notes : null,
    followup_notes: (t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : null,
  }), [])

  /** True empty placeholder rows only (not rows with status/issue data on an empty- id). */
  const isBillingTodoEmptyPlaceholder = useCallback((t: TodoItem) => {
    return (
      t.id.startsWith('empty-') &&
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

  const fetchTodos = useCallback(async () => {
    try {
      const { data: todosData, error: todosError } = await apiClient
        .from('todo_lists')
        .select('*')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })

      if (todosError) throw todosError
      const fetchedTodos = (todosData || []).map(normalizeTodoRow)

      fetchedTodos.forEach((t) => {
        lastSavedSnapshotRef.current.set(t.id, {
          issue: t.issue,
          notes: t.notes,
          followup_notes: t.followup_notes,
          status: (t.status === 'Open' || !t.status) ? '' : t.status,
        })
      })

      setTodos((currentTodos) => {
        if (currentTodos.length === 0) {
          const todosToUse = sortBillingTodosCompleteAtBottom(fetchedTodos.slice(0, 200))
          const emptyRowsNeeded = 200 - todosToUse.length
          const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyTodo(i))
          return [...todosToUse, ...newEmptyRows]
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
            }
          }
        })
        const newFetchedTodos = Array.from(fetchedTodosMap.values()).map(normalizeTodoRow)
        const updated = [...preservedOrder, ...newFetchedTodos]

        const nonEmpty = updated.filter((t) => !t.id.startsWith('empty-'))
        const emptyOnes = updated.filter((t) => t.id.startsWith('empty-'))
        let result = sortBillingTodosCompleteAtBottom([...nonEmpty, ...emptyOnes])

        const totalRows = result.length
        const emptyRowsNeeded = Math.max(0, 200 - totalRows)
        const existingEmptyCount = result.filter((t) => t.id.startsWith('empty-')).length
        const newEmptyRows = Array.from({ length: emptyRowsNeeded }, (_, i) =>
          createEmptyTodo(existingEmptyCount + i)
        )
        return [...result, ...newEmptyRows]
      })
    } catch (error) {
      console.error('Error fetching todos:', error)
    } finally {
      setLoading(false)
    }
  }, [clinicId, createEmptyTodo, normalizeTodoRow, sortBillingTodosCompleteAtBottom])

  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  useEffect(() => {
    if (!clinicId) return
    fetchTodos().then(() => {
      setStructureVersion((v) => v + 1)
    })
  }, [clinicId, fetchTodos])

  const saveTodos = useCallback(async (todosToSave: TodoItem[]) => {
    if (!clinicId || !userProfile) return

    const normalizeSnap = (t: TodoItem) => ({
      issue: (t.issue && t.issue !== 'null') ? t.issue : null,
      notes: (t.notes && t.notes !== 'null') ? t.notes : null,
      followup_notes: (t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : null,
      status: (t.status === 'Open' || !t.status) ? '' : t.status,
    })

    // Same rule as before: only rows with issue/notes/followup_notes count as data (not status alone)
    const hasMeaningfulData = (t: TodoItem) => !!(t.issue || t.notes || t.followup_notes)

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
      return snap.issue !== cur.issue || snap.notes !== cur.notes || snap.followup_notes !== cur.followup_notes || snap.status !== cur.status
    })

    if (todosToProcess.length === 0) {
      saveTriggeredByRowLeaveRef.current = false
      return
    }

    saveInProgressRef.current = true
    let resolveSaveComplete!: () => void
    const saveCompletePromise = new Promise<void>((r) => {
      resolveSaveComplete = r
    })
    saveCompletePromiseRef.current = { promise: saveCompletePromise, resolve: resolveSaveComplete }

    try {
      const savedTodosMap = new Map<string, TodoItem>()

      for (let i = 0; i < todosToProcess.length; i++) {
        const todo = todosToProcess[i]
        const oldId = todo.id
        const statusValue = (todo.status === 'Open' || !todo.status) ? '' : todo.status
        const todoData: Record<string, unknown> = {
          clinic_id: clinicId,
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
    } catch (error) {
      console.error('[saveTodos] Error saving todos:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (
        !errorMessage.includes('todo_lists table does not exist') &&
        !errorMessage.includes('relation') &&
        !errorMessage.includes('does not exist')
      ) {
        alert(errorMessage || 'Failed to save todo. Please try again.')
      }
    } finally {
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

  const padBillingTodosTo200 = useCallback(
    (list: TodoItem[]) => {
      const result = [...list]
      while (result.length > 200) {
        const last = result[result.length - 1]
        if (last && isBillingTodoEmptyPlaceholder(last)) result.pop()
        else break
      }
      const trimmed = result.length > 200 ? result.slice(0, 200) : result
      const out = [...trimmed]
      while (out.length < 200) {
        out.push(createEmptyTodo(nextEmptyNumericIdSuffix(out)))
      }
      return out
    },
    [createEmptyTodo, isBillingTodoEmptyPlaceholder]
  )

  const syncTodosFromHotAfterUndoRedo = useCallback(() => {
    const hot = hotRef.current
    if (!hot || (hot as any).isDestroyed) return
    if (!canEdit) return
    try {
      const grid = hot.getData() as (string | number | null | undefined)[][]
      const prev = todosRef.current
      const next: TodoItem[] = []
      for (let i = 0; i < grid.length; i++) {
        const row = grid[i]
        const p = prev[i] ?? createEmptyTodo(nextEmptyNumericIdSuffix(next))
        next.push(mergeBillingTodoFromGridRow(p, row))
      }
      const padded = padBillingTodosTo200(next)
      todosRef.current = padded
      setTodos(padded)
      void saveTodos(padded).catch((err) => console.error('saveTodos after HOT undo/redo sync', err))
    } catch (e) {
      console.error('syncTodosFromHotAfterUndoRedo', e)
    }
  }, [canEdit, createEmptyTodo, padBillingTodosTo200, saveTodos])

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
      const snap = [...todosRef.current]
      const removed = physicalRows.map((i) => snap[i]).filter(Boolean)
      removed.forEach((t) => {
        if (t.id.startsWith('empty-')) return
        void handleDeleteTodo(t.id)
      })
      setTodos((prev) => {
        const rm = new Set(physicalRows)
        const next = prev.filter((_, i) => !rm.has(i))
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
    [canEdit, handleDeleteTodo, padBillingTodosTo200, saveTodos, sortBillingTodosCompleteAtBottom]
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
    const rowsWithData = todos.filter(t => t.issue || t.status || t.notes || t.followup_notes)
    const statusDisplay = (s: string | null) => (s && s !== 'Open') ? s : ''
    const csvRows = [
      headers.join(','),
      ...rowsWithData.map(t => [
        t.id.startsWith('empty-') || t.id.startsWith('new-') ? '' : t.id.substring(0, 8) + '...',
        escapeCsv(statusDisplay(t.status || '')),
        escapeCsv((t.issue && t.issue !== 'null') ? t.issue : ''),
        escapeCsv((t.notes && t.notes !== 'null') ? t.notes : ''),
        escapeCsv((t.followup_notes && t.followup_notes !== 'null') ? t.followup_notes : ''),
      ].join(',')),
    ]
    const csv = csvRows.join('\r\n')
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

  // Reorder todos when user drags a row by the row header; persist order via created_at so reload preserves it
  const handleTodosRowMove = useCallback((movedRows: number[], finalIndex: number) => {
    setTodos((prev) => {
      const arr = [...prev]
      const toMove = movedRows.map((i) => arr[i])
      movedRows.sort((a, b) => b - a).forEach((i) => arr.splice(i, 1))
      const insertAt = Math.min(finalIndex, arr.length)
      toMove.forEach((item, i) => arr.splice(insertAt + i, 0, item))
      const next = sortBillingTodosCompleteAtBottom(arr)
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
  }, [sortBillingTodosCompleteAtBottom])

  // Convert todos to Handsontable data format
  const getTodosHandsontableData = useCallback(() => {
    return todos.map(todo => [
      // Read-only preview of real UUIDs only; keep empty for placeholder rows (like Patient ID on PatientsTab)
      todo.id.startsWith('empty-') || todo.id.startsWith('new-') ? '' : todo.id.substring(0, 8) + '...',
      // No "Open" status; when no value or legacy "Open", show empty cell
      (todo.status && todo.status !== 'Open') ? todo.status : '',
      (todo.issue && todo.issue !== 'null') ? todo.issue : '',
      (todo.notes && todo.notes !== 'null') ? todo.notes : '',
      (todo.followup_notes && todo.followup_notes !== 'null') ? todo.followup_notes : '',
    ])
  }, [todos])

  // Column field names mapping to is_lock_billing_todo table columns
  const columnFields: Array<keyof IsLockBillingTodo> = ['id_column', 'status', 'issue', 'notes', 'followup_notes']
  const columnTitles = ['ID', 'Status', 'Issue', 'Notes', 'F/u notes']

  const todosCellsCallback = useCallback(
    (row: number, col: number) => {
      const todo = todos[row]
      const colKey = columnFields[col]
      if (!colKey) return {}
      const key = `${todo?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key) ? { className: 'cell-highlight-yellow' } : {}
    },
    [todos, columnFields, highlightedCells]
  )

  const getCellIsHighlighted = useCallback(
    (row: number, col: number) => {
      const todo = todos[row]
      const colKey = columnFields[col]
      if (!colKey) return false
      const key = `${todo?.id ?? `row-${row}`}:${colKey}`
      return highlightedCells.has(key)
    },
    [todos, columnFields, highlightedCells]
  )

  const handleCellHighlight = useCallback((row: number, col: number) => {
    const todo = todos[row]
    const colKey = columnFields[col]
    if (!colKey) return
    const key = `${todo?.id ?? `row-${row}`}:${colKey}`
    setHighlightedCells((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [todos, columnFields])

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
      readOnly: !canEdit || getReadOnly('status'),
      columnSorting: { headerAction: false },
    },
    { 
      data: 2, 
      title: 'Issue', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('issue'),
      columnSorting: { headerAction: false },
    },
    { 
      data: 3, 
      title: 'Notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('notes'),
      columnSorting: { headerAction: false },
    },
    { 
      data: 4, 
      title: 'F/u notes', 
      type: 'text' as const, 
      width: 200,
      readOnly: !canEdit || getReadOnly('followup_notes'),
      columnSorting: { headerAction: false },
    },
  ], [canEdit, lockData, getStatusColor])

  const handleTodosHandsontableChange = useCallback(
    (changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
      if (!changes || source === 'loadData') return

      const currentTodos = todosRef.current.length > 0 ? todosRef.current : todos
      const updatedTodos = [...currentTodos]
      const fields: Array<'id' | 'status' | 'issue' | 'notes' | 'followup_notes'> = [
        'id',
        'status',
        'issue',
        'notes',
        'followup_notes',
      ]

      const rowsInChange = [...new Set(changes.map(([r]) => r))]
      const primaryRow = rowsInChange[0] ?? null
      const prevRow = lastEditedRowRef.current
      const didLeaveRow = prevRow !== null && primaryRow !== null && !rowsInChange.includes(prevRow)

      changes.forEach(([row, col, , newValue]) => {
        while (updatedTodos.length <= row) {
          const existingEmptyCount = updatedTodos.filter((t) => t.id.startsWith('empty-')).length
          updatedTodos.push(createEmptyTodo(existingEmptyCount))
        }
        const todo = updatedTodos[row]
        if (todo) {
          const field = fields[col as number]
          if (field === 'status') {
            updatedTodos[row] = { ...todo, status: String(newValue || ''), updated_at: new Date().toISOString() }
          } else if (field === 'issue') {
            const issueVal = newValue === '' || newValue === 'null' ? null : String(newValue)
            updatedTodos[row] = { ...todo, issue: issueVal, updated_at: new Date().toISOString() }
          } else if (field === 'notes') {
            const notesVal = newValue === '' || newValue === 'null' ? null : String(newValue)
            updatedTodos[row] = { ...todo, notes: notesVal, updated_at: new Date().toISOString() }
          } else if (field === 'followup_notes') {
            const followupVal = newValue === '' || newValue === 'null' ? null : String(newValue)
            updatedTodos[row] = { ...todo, followup_notes: followupVal, updated_at: new Date().toISOString() }
          }
        }
      })

      const statusChanged = changes.some(([, col]) => col === 1)
      if (statusChanged) {
        const dataRows = updatedTodos.filter((t) => !isBillingTodoEmptyPlaceholder(t))
        let incomplete = dataRows.filter((t) => t.status !== 'Complete')
        const complete = dataRows.filter((t) => t.status === 'Complete')
        const emptyRows = updatedTodos.filter((t) => isBillingTodoEmptyPlaceholder(t))
        const movedToTopIds = new Set<string>()
        changes.forEach(([row, col, oldVal, newVal]) => {
          if (
            col === 1 &&
            row < updatedTodos.length &&
            oldVal === 'Complete' &&
            newVal !== 'Complete'
          ) {
            movedToTopIds.add(updatedTodos[row].id)
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
          const existingEmptyCount = reordered.filter((t) => t.id.startsWith('empty-')).length
          reordered.push(createEmptyTodo(existingEmptyCount))
        }
        if (reordered.length > updatedTodos.length) {
          reordered.length = updatedTodos.length
        }
        updatedTodos.length = 0
        updatedTodos.push(...reordered)
      }

      if (updatedTodos.length > 200) {
        updatedTodos.length = 200
      }
      if (updatedTodos.length < 200) {
        const emptyRowsNeeded = 200 - updatedTodos.length
        const existingEmptyCount = updatedTodos.filter((t) => t.id.startsWith('empty-')).length
        updatedTodos.push(
          ...Array.from({ length: emptyRowsNeeded }, (_, i) => createEmptyTodo(existingEmptyCount + i))
        )
      }

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
        }
      }

      const hasMeaningfulChange = changes.some(([, col]) => col === 1 || col === 2 || col === 3 || col === 4)
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
    [saveTodos, createEmptyTodo, todos, isBillingTodoEmptyPlaceholder]
  )

  const handleAfterSelection = useCallback(
    (r: number, _c: number, _r2: number, _c2: number) => {
      const prev = lastSelectedRowRef.current
      if (prev !== null && r !== prev && !saveInProgressRef.current) {
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
          saveTodos(todosRef.current).catch((err) =>
            console.error('[BillingTodo→] Error flushing save on selection change (fallback):', err)
          )
        }, FALLBACK_MS)
      }
      lastSelectedRowRef.current = r
    },
    [saveTodos]
  )

  const handleAfterDeselect = useCallback(() => {
    if (saveInProgressRef.current) return
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
    saveTodos(todosRef.current).catch((err) =>
      console.error('[BillingTodo→] Error flushing save on deselect (click outside):', err)
    )
  }, [saveTodos])

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
        <div className="text-center text-white/70 py-8">Loading to-do items...</div>
      </div>
    )
  }

  return (
    <div 
      className="p-6" 
      style={isInSplitScreen ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}}
    >
      <div 
        ref={tableContainerRef}
        className="table-container dark-theme" 
        style={{ 
          maxHeight: isInSplitScreen ? undefined : '600px',
          flex: isInSplitScreen ? 1 : undefined,
          minHeight: isInSplitScreen ? 0 : undefined,
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          backgroundColor: '#d2dbe5'
        }}
      >
        <HandsontableWrapper
          key={`todos-${clinicId}`}
          hotInstanceRef={hotRef}
          data={getTodosHandsontableData()}
          dataVersion={structureVersion}
          columns={todosColumns}
          colHeaders={columnTitles}
          rowHeaders={true}
          width="100%"
          height={isInSplitScreen ? tableHeight : 600}
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
    </div>
  )
}
