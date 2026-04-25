import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient } from '@/lib/apiClient'
import { TodoItem } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Trash2 } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'

export default function BillingTodo() {
  const { userProfile } = useAuth()
  const [todos, setTodos] = useState<TodoItem[]>([])
  const todosRef = useRef<TodoItem[]>([])
  const [todoNotes, setTodoNotes] = useState<Record<string, Array<{ id: string; note: string; created_at: string }>>>({})
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState<{ todoId: string; field: string } | null>(null)
  const [clinics, setClinics] = useState<Array<{ id: string; name: string }>>([])
  const fetchingRef = useRef(false)
  const editingSelectRef = useRef<{ todoId: string; field: string } | null>(null)
  const resetLastSavedRef = useRef<(() => void) | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; todoId: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Keep ref in sync with state
  useEffect(() => {
    todosRef.current = todos
  }, [todos])

  // Fetch clinics for super_admin
  useEffect(() => {
    const fetchClinics = async () => {
      if (userProfile?.role === 'super_admin') {
        try {
          const { data, error } = await apiClient
            .from('clinics')
            .select('id, name')
            .order('name')
          
          if (error) throw error
          setClinics(data || [])
        } catch (error) {
          // Error fetching clinics
        }
      }
    }
    fetchClinics()
  }, [userProfile])

  const fetchNotesForTodos = useCallback(async (todoIds: string[]) => {
    if (todoIds.length === 0) return
    
    try {
      const { data, error } = await apiClient
        .from('todo_notes')
        .select('*')
        .in('todo_id', todoIds)
        .order('created_at', { ascending: false })

      if (error) throw error
      
      // Group notes by todo_id
      const notesByTodo: Record<string, Array<{ id: string; note: string; created_at: string }>> = {}
      data?.forEach(note => {
        if (!notesByTodo[note.todo_id]) {
          notesByTodo[note.todo_id] = []
        }
        notesByTodo[note.todo_id].push(note)
      })
      setTodoNotes(prev => ({ ...prev, ...notesByTodo }))
    } catch (error) {
      // Error fetching notes
    }
  }, [])

  const fetchTodos = useCallback(async () => {
    if (!userProfile) {
      setLoading(false)
      return
    }

    fetchingRef.current = true
    try {
      let query = apiClient
        .from('todo_lists')
        .select('*')
        .is('completed_at', null)
        .order('created_at', { ascending: false })

      // For super_admin, fetch all todos. For others, filter by clinic_ids
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('clinic_id', userProfile.clinic_ids)
      } else if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length === 0) {
        // Non-super_admin with no clinic_ids - no todos to show
        setTodos([])
        todosRef.current = []
        setLoading(false)
        fetchingRef.current = false
        return
      }

      const { data, error } = await query
      if (error) throw error
      const fetchedTodos = data || []
      
      // Preserve any unsaved todos (with 'new-' prefix) that exist in current state
      setTodos(currentTodos => {
        const unsavedTodos = currentTodos.filter(t => t.id.startsWith('new-'))
        const combined = [...unsavedTodos, ...fetchedTodos]
        return combined
      })
      
      // Update ref with only saved todos (for comparison in saveTodo)
      todosRef.current = fetchedTodos
      
      // Fetch notes for all todos (including saved ones)
      if (fetchedTodos.length > 0) {
        const todoIds = fetchedTodos.map(t => t.id)
        await fetchNotesForTodos(todoIds)
      }
    } catch (error) {
      // Error fetching todos
    } finally {
      setLoading(false)
      // Reset fetching flag after a short delay to allow state to update
      setTimeout(() => {
        fetchingRef.current = false
        if (resetLastSavedRef.current) {
          resetLastSavedRef.current()
        }
      }, 200)
    }
  }, [userProfile, fetchNotesForTodos])

  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])



  const saveTodo = useCallback(async (todosToSave: TodoItem[]) => {
    if (!userProfile?.id) return
    
    // For non-super_admin, require clinic_ids
    if (userProfile.role !== 'super_admin' && !userProfile?.clinic_ids?.[0]) {
      return
    }

    try {
      const newTodosToCreate: TodoItem[] = []
      const todosToUpdate: TodoItem[] = []
      
      // Get last saved state from ref for comparison
      const lastSavedTodos = todosRef.current.filter(t => !t.id.startsWith('new-'))
      
      // Separate new and existing todos
      for (const todo of todosToSave) {
        if (todo.id.startsWith('new-')) {
          // Only create if it has an issue
          if (todo.issue && todo.issue.trim()) {
            newTodosToCreate.push(todo)
          }
        } else {
          // Compare with last saved state to detect actual changes
          const lastSavedTodo = lastSavedTodos.find(t => t.id === todo.id)
          if (lastSavedTodo) {
            const hasChanged = 
              lastSavedTodo.issue !== todo.issue ||
              lastSavedTodo.status !== todo.status
            
            if (hasChanged) {
              todosToUpdate.push(todo)
            }
          } else {
            // Todo exists in current state but not in last saved - it's new, update it
            todosToUpdate.push(todo)
          }
        }
      }

      // If no changes, don't do anything
      if (newTodosToCreate.length === 0 && todosToUpdate.length === 0) {
        return
      }

      // Create new todos
      for (const todo of newTodosToCreate) {
        const { error } = await apiClient
          .from('todo_lists')
          .insert({
            clinic_id: todo.clinic_id,
            issue: todo.issue,
            status: todo.status,
            notes: todo.notes,
            followup_notes: todo.followup_notes,
            created_by: userProfile.id,
          })
        
        if (error) {
          console.error('Error creating todo:', error)
          throw error
        }
      }

      // Update existing todos that have changed
      for (const todo of todosToUpdate) {
        const { error } = await apiClient
          .from('todo_lists')
          .update({
            issue: todo.issue,
            status: todo.status,
            notes: todo.notes,
            followup_notes: todo.followup_notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', todo.id)
        
        if (error) {
          // Error updating todo
          throw error
        }
        
        // Update the ref immediately with the saved values to prevent re-saving
        todosRef.current = todosRef.current.map(t => 
          t.id === todo.id ? { ...t, ...todo, updated_at: new Date().toISOString() } : t
        )
      }

      // Only fetch if we created new todos (to get their IDs)
      // For updates, don't fetch or update state - just update the ref
      // The state already has the correct values (user just changed them)
      if (newTodosToCreate.length > 0) {
        await fetchTodos()
      } else if (todosToUpdate.length > 0) {
        // For updates, just update the ref to match what was saved
        // Don't update state to avoid triggering debounced save again
        todosRef.current = todosRef.current.map(t => {
          const updated = todosToUpdate.find(u => u.id === t.id)
          if (updated) {
            return { ...t, ...updated, updated_at: new Date().toISOString() }
          }
          return t
        })
        
        // Update the debounced save state with the current todos state
        // The state already has the user's changes, which we just saved
        // This prevents it from trying to save again
        updateLastSaved(todos)
      }
    } catch (error) {
      console.error('Error saving todos:', error)
      alert('Failed to save changes. Please try again.')
    }
  }, [userProfile, fetchTodos])

  const savingRef = useRef(false)
  const lastSaveTimeRef = useRef<number>(0)
  const lastSaveDataRef = useRef<string>('')
  
  const saveTodoWithFlag = useCallback(async (todosToSave: TodoItem[]) => {
    // Don't save if we're currently fetching or already saving
    if (savingRef.current || fetchingRef.current) {
      return
    }
    
    // CRITICAL: Don't save if we're currently editing a select field (status or claim_reference)
    // The onBlur handler will handle the save instead
    if (editingSelectRef.current) {
      return
    }
    
    // Prevent saving the same data multiple times in quick succession (within 2 seconds)
    const now = Date.now()
    const dataString = JSON.stringify(todosToSave)
    if (now - lastSaveTimeRef.current < 2000 && dataString === lastSaveDataRef.current) {
      return
    }
    
    // Quick check: if todosToSave matches todosRef.current exactly, don't save
    const currentSaved = todosRef.current.filter(t => !t.id.startsWith('new-'))
    const toSaveSaved = todosToSave.filter(t => !t.id.startsWith('new-'))
    
    // Compare only the fields we care about
    const hasRealChanges = toSaveSaved.some(todo => {
      const saved = currentSaved.find(s => s.id === todo.id)
      if (!saved) return true // New todo
      return (
        saved.issue !== todo.issue ||
        saved.status !== todo.status
      )
    })
    
    if (!hasRealChanges && toSaveSaved.length === currentSaved.length) {
      return
    }
    
    savingRef.current = true
    lastSaveTimeRef.current = now
    lastSaveDataRef.current = dataString
    try {
      await saveTodo(todosToSave)
    } finally {
      savingRef.current = false
    }
  }, [saveTodo])

  const { saveImmediately, resetLastSaved, updateLastSaved } = useDebouncedSave<TodoItem[]>(saveTodoWithFlag, todos, 1000, editingCell !== null)
  
  // Store resetLastSaved in ref so it can be used in fetchTodos
  useEffect(() => {
    resetLastSavedRef.current = resetLastSaved
  }, [resetLastSaved])

  // Fetch todos on mount and when userProfile changes
  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])

  const handleUpdateTodo = useCallback((todoId: string, field: string, value: any) => {
    setTodos(prevTodos => {
      return prevTodos.map(todo => {
        if (todo.id === todoId) {
          return { ...todo, [field]: value, updated_at: new Date().toISOString() }
        }
        return todo
      })
    })
  }, [])

  const handleAddNewRow = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    
    if (!userProfile?.id) {
      alert('Unable to add new item: User not logged in')
      return
    }

    // Determine clinic_id: use first clinic_id from user, or first clinic for super_admin
    let clinicId: string
    if (userProfile.role === 'super_admin') {
      if (clinics.length > 0) {
        clinicId = clinics[0].id
      } else if (userProfile.clinic_ids?.[0]) {
        clinicId = userProfile.clinic_ids[0]
      } else {
        alert('Unable to add new item: No clinics available. Please create a clinic first.')
        return
      }
    } else {
      if (!userProfile.clinic_ids?.[0]) {
        alert('Unable to add new item: No clinic assigned to your account')
        return
      }
      clinicId = userProfile.clinic_ids[0]
    }
    
    const tempId = `new-${Date.now()}`
    const newTodo: TodoItem = {
      id: tempId,
      clinic_id: clinicId,
      issue: null,
      status: 'Open',
      notes: null,
      followup_notes: null,
      created_by: userProfile.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    }
    
    setTodos(prev => [newTodo, ...prev])
    setEditingCell({ todoId: tempId, field: 'title' })
  }, [userProfile, clinics])

  const handleAddNote = async (todoId: string, noteText: string, isFollowUp: boolean = false) => {
    if (!noteText.trim() || !userProfile) return

    // Don't save notes for new todos that haven't been created yet
    if (todoId.startsWith('new-')) {
      // For new todos, we'll save the note after the todo is created
      return
    }

    try {
      // For follow-up notes, prefix with [F/U]
      const noteToSave = isFollowUp ? `[F/U] ${noteText}` : noteText
      
      const { error } = await apiClient
        .from('todo_notes')
        .insert({
          todo_id: todoId,
          note: noteToSave,
          created_by: userProfile.id,
        })

      if (error) throw error
      await fetchNotesForTodos([todoId])
    } catch (error) {
      // Error adding note
      alert('Failed to add note. Please try again.')
    }
  }

  const handleDelete = async (todoId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      const { error } = await apiClient
        .from('todo_lists')
        .delete()
        .eq('id', todoId)

      if (error) throw error
      await fetchTodos()
    } catch (error) {
      console.error('Error deleting todo:', error)
      alert('Failed to delete item. Please try again.')
    }
  }

  const getStatusOptions = () => ['Open', '1 Waiting', '2 IP', 'In Progress', 'Resolved']
  const getIssueOptions = () => ['Needs Reprocessing', 'Repeat F/U', 'New F/U', 'Claim Issue', 'Payment Issue']

  const getStatusColor = (status: string) => {
    if (status === '1 Waiting') return '#ef4444' // red
    if (status === '2 IP') return '#a855f7' // purple
    if (status === 'Open') return '#f59e0b' // orange
    return '#3b82f6' // blue
  }


  const canEdit = ['billing_staff', 'admin', 'super_admin'].includes(userProfile?.role || '')

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent, todoId: string) => {
    if (!canEdit) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, todoId })
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [contextMenu])

  // Handle delete from context menu
  const handleContextMenuDelete = (todoId: string) => {
    handleDelete(todoId)
    setContextMenu(null)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Billing To-Do List</h1>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
        {loading ? (
          <div className="text-center py-8 text-white/70">Loading...</div>
        ) : (
          <div className="table-container dark-theme">
            <table className="table-spreadsheet dark-theme">
              <thead>
                <tr>
                  <th style={{ width: 'auto', minWidth: '60px' }}>ID</th>
                  <th style={{ width: 'auto', minWidth: '120px' }}>Title</th>
                  <th style={{ width: 'auto', minWidth: '100px' }}>Status</th>
                  <th style={{ width: 'auto', minWidth: '120px' }}>Issues</th>
                  <th style={{ width: 'auto', minWidth: '150px' }}>Notes</th>
                  <th style={{ width: 'auto', minWidth: '150px' }}>F/u Notes</th>
                  {canEdit && <th style={{ width: '80px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {canEdit && (
                  <tr 
                    className="editing" 
                    onClick={(e) => {
                      handleAddNewRow(e)
                    }} 
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ''}
                  >
                    <td 
                      colSpan={7} 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAddNewRow(e)
                      }}
                      style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)', padding: '16px', pointerEvents: 'auto' }}
                    >
                      Click here to add a new to-do item
                    </td>
                  </tr>
                )}
                {todos.map((todo) => {
                  const notes = todoNotes[todo.id] || []
                  // Separate notes: those starting with [F/U] are follow-up notes
                  const regularNotes = notes.filter(n => !n.note.startsWith('[F/U]'))
                  const followUpNotes = notes.filter(n => n.note.startsWith('[F/U]')).map(n => ({
                    ...n,
                    note: n.note.replace(/^\[F\/U\]\s*/, '')
                  }))
                  const latestNote = regularNotes[0]
                  const latestFollowUp = followUpNotes[0]
                  const isNew = todo.id.startsWith('new-')

                  return (
                    <tr 
                      key={todo.id} 
                      className={isNew ? 'editing' : ''}
                      onContextMenu={(e) => canEdit && !isNew && handleContextMenu(e, todo.id)}
                    >
                      <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                        {isNew ? 'New' : todo.id.substring(0, 8)}
                      </td>
                      <td>
                        <input
                          type="text"
                          value={todo.issue || ''}
                          onChange={(e) => handleUpdateTodo(todo.id, 'issue', e.target.value || null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full"
                          placeholder={canEdit ? 'Enter title...' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            fontWeight: todo.issue ? 500 : 'normal',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <select
                          value={todo.status}
                          onChange={(e) => {
                            handleUpdateTodo(todo.id, 'status', e.target.value)
                          }}
                          onFocus={() => {
                            editingSelectRef.current = { todoId: todo.id, field: 'status' }
                          }}
                          onBlur={async (e) => {
                            editingSelectRef.current = null
                            const savedTodo = todosRef.current.find(t => t.id === todo.id)
                            const newValue = e.target.value
                            if (savedTodo && newValue !== savedTodo.status) {
                              todosRef.current = todosRef.current.map(t => 
                                t.id === todo.id ? { ...t, status: newValue } : t
                              )
                              await saveImmediately()
                            }
                          }}
                          disabled={!canEdit}
                          className="w-full"
                          style={{ 
                            backgroundColor: getStatusColor(todo.status), 
                            color: '#ffffff',
                            border: 'none',
                            outline: 'none'
                          }}
                        >
                          {getStatusOptions().map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={todo.notes || ''}
                          onChange={(e) => {
                            handleUpdateTodo(todo.id, 'notes', e.target.value || null)
                          }}
                          onFocus={() => {
                            editingSelectRef.current = { todoId: todo.id, field: 'notes' }
                          }}
                          onBlur={async (e) => {
                            editingSelectRef.current = null
                            const savedTodo = todosRef.current.find(t => t.id === todo.id)
                            const newValue = e.target.value || null
                            if (savedTodo && newValue !== savedTodo.notes) {
                              todosRef.current = todosRef.current.map(t => 
                                t.id === todo.id ? { ...t, notes: newValue } : t
                              )
                              await saveImmediately()
                            }
                          }}
                          disabled={!canEdit}
                          className="w-full"
                          style={{ 
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            color: '#000000',
                            border: 'none',
                            outline: 'none'
                          }}
                        >
                          <option value="">Select...</option>
                          {getIssueOptions().map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <textarea
                          value={latestNote?.note || ''}
                          onChange={() => {
                            // Handle onChange for controlled component
                          }}
                          onBlur={async (e) => {
                            const newValue = e.target.value.trim()
                            if (newValue && newValue !== latestNote?.note) {
                              await handleAddNote(todo.id, newValue, false)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.currentTarget.blur()
                            } else if (e.key === 'Enter' && e.ctrlKey) {
                              e.currentTarget.blur()
                            }
                          }}
                          disabled={!canEdit}
                          className="w-full"
                          rows={2}
                          placeholder={canEdit ? 'Add note...' : '-'}
                          style={{ 
                            minHeight: '48px', 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <textarea
                          value={latestFollowUp?.note || ''}
                          onChange={() => {
                            // Handle onChange for controlled component
                          }}
                          onBlur={async (e) => {
                            const newValue = e.target.value.trim()
                            if (newValue && newValue !== latestFollowUp?.note) {
                              await handleAddNote(todo.id, newValue, true)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.currentTarget.blur()
                            } else if (e.key === 'Enter' && e.ctrlKey) {
                              e.currentTarget.blur()
                            }
                          }}
                          disabled={!canEdit}
                          className="w-full"
                          rows={2}
                          placeholder={canEdit ? 'Add follow-up note...' : '-'}
                          style={{ 
                            minHeight: '48px', 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            onClick={() => handleDelete(todo.id)}
                            className="text-red-400 hover:text-red-300"
                            style={{ padding: '4px' }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {todos.length === 0 && !canEdit && (
                  <tr className="empty-row">
                    <td colSpan={6}>
                      No items in your To-Do list
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[150px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <button
            onClick={() => handleContextMenuDelete(contextMenu.todoId)}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
