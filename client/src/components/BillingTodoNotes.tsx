import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, List, ListOrdered } from 'lucide-react'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'

interface BillingTodoNotesProps {
  clinicId: string
  canEdit: boolean
}

/**
 * Clinic-wide freeform notepad rendered as the "Notes" sub-tab on the Billing To-Do page.
 * - Uses a `contenteditable` div so the user can bold / italicize / underline text inline.
 * - Text wraps naturally; Enter starts a new paragraph. No row limits.
 * - Persists to `billing_todo_notes` (one row per clinic, upsert on clinic_id). Content is HTML so
 *   the formatting round-trips. Saves are debounced ~800 ms while the user types; a final save is
 *   flushed on blur / unmount so nothing is lost on tab switch.
 */
export default function BillingTodoNotes({ clinicId, canEdit }: BillingTodoNotesProps) {
  const { userProfile } = useAuth()
  const editorRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const contentRef = useRef<string>('')
  const lastSavedRef = useRef<string>('')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** False until the first fetch finishes — prevents unmount/cleanup from upserting empty HTML
   *  over real DB content when the user switches tabs mid-load. */
  const hydratedRef = useRef(false)
  /** Tracks whether we've painted fetched HTML into the editor after it mounts. */
  const editorHydratedRef = useRef(false)

  const fetchNotes = useCallback(async () => {
    if (!clinicId) return
    hydratedRef.current = false
    editorHydratedRef.current = false
    try {
      const { data, error } = await apiClient
        .from('billing_todo_notes')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle()
      if (error) throw error
      const html = (data?.content as string | undefined) ?? ''
      contentRef.current = html
      lastSavedRef.current = html
      hydratedRef.current = true
    } catch (e) {
      console.error('[BillingTodoNotes] fetch error:', e)
      // Still mark hydrated so subsequent edits can attempt save (and surface errors).
      contentRef.current = ''
      lastSavedRef.current = ''
      hydratedRef.current = true
      setSaveError(e instanceof Error ? e.message : 'Failed to load notes')
    } finally {
      setLoading(false)
    }
  }, [clinicId])

  useEffect(() => {
    setLoading(true)
    fetchNotes()
  }, [fetchNotes])

  // Apply loaded HTML once the contenteditable node exists. fetchNotes used to set
  // editorRef.innerHTML while `loading` was still true — the editor wasn't mounted yet, so
  // notes always opened blank and looked "lost" after click-away / tab switch.
  useEffect(() => {
    if (loading || editorHydratedRef.current) return
    const el = editorRef.current
    if (!el) return
    el.innerHTML = contentRef.current
    editorHydratedRef.current = true
  }, [loading])

  const readEditorHtml = useCallback(() => {
    const el = editorRef.current
    if (el) contentRef.current = el.innerHTML
    return contentRef.current
  }, [])

  const saveNow = useCallback(async () => {
    if (!clinicId || !hydratedRef.current) return
    const html = readEditorHtml()
    if (html === lastSavedRef.current) return
    setSaving(true)
    setSaveError(null)
    try {
      const { error } = await apiClient
        .from('billing_todo_notes')
        .upsert(
          {
            clinic_id: clinicId,
            content: html,
            updated_by: userProfile?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clinic_id' },
        )
      if (error) throw error
      lastSavedRef.current = html
      setSavedAt(new Date())
    } catch (e) {
      console.error('[BillingTodoNotes] save error:', e)
      const message = e instanceof Error ? e.message : 'Failed to save notes'
      setSaveError(message)
    } finally {
      setSaving(false)
    }
  }, [clinicId, userProfile, readEditorHtml])

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      void saveNow()
    }, 800)
  }, [saveNow])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      // Best-effort flush; skip if we never finished loading (avoids wiping DB with '').
      if (hydratedRef.current) {
        void saveNow()
      }
    }
  }, [saveNow])

  const handleInput = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    contentRef.current = el.innerHTML
    scheduleSave()
  }, [scheduleSave])

  const applyFormat = useCallback(
    (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList') => {
      if (!canEdit) return
      editorRef.current?.focus()
      // document.execCommand is deprecated but still the most compatible way to toggle inline
      // formatting on a contenteditable region across browsers. All modern browsers still honor
      // bold/italic/underline/lists — good enough for a per-clinic scratchpad.
      document.execCommand(command)
      handleInput()
    },
    [canEdit, handleInput],
  )

  const savedLabel = saveError
    ? `Save failed: ${saveError}`
    : saving
      ? 'Saving…'
      : savedAt
        ? `Saved ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : lastSavedRef.current
          ? 'All changes saved'
          : ''

  return (
    <div className="p-6 flex flex-col" style={{ minHeight: '650px' }}>
      <div className="mb-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 rounded-md border border-white/20 bg-white/5 p-1">
          <button
            type="button"
            title="Bold (Ctrl+B)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat('bold')}
            disabled={!canEdit}
            className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Italic (Ctrl+I)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat('italic')}
            disabled={!canEdit}
            className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Underline (Ctrl+U)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat('underline')}
            disabled={!canEdit}
            className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Underline className="w-4 h-4" />
          </button>
          <span className="w-px h-5 bg-white/20 mx-1" />
          <button
            type="button"
            title="Bulleted list"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat('insertUnorderedList')}
            disabled={!canEdit}
            className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Numbered list"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFormat('insertOrderedList')}
            disabled={!canEdit}
            className="p-1.5 rounded text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
        </div>
        <div className={`text-xs ${saveError ? 'text-red-300' : 'text-white/60'}`}>
          {savedLabel}
        </div>
      </div>

      <div
        className="flex-1 flex flex-col rounded-md border border-white/20 bg-white/95 overflow-hidden"
        style={{ minHeight: '480px' }}
      >
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">Loading notes…</div>
        ) : (
          <div
            ref={editorRef}
            className="billing-todo-notes-editor flex-1 overflow-auto p-4 text-slate-900 outline-none"
            contentEditable={canEdit}
            suppressContentEditableWarning
            onInput={handleInput}
            onBlur={() => void saveNow()}
            data-placeholder={canEdit ? 'Type notes here…' : 'No notes yet.'}
            style={{
              minHeight: '480px',
              lineHeight: 1.6,
              fontSize: '14px',
              cursor: canEdit ? 'text' : 'default',
            }}
          />
        )}
      </div>
    </div>
  )
}
