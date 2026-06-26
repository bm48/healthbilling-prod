import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { listAutoBackups, type AutoBackupVersion } from '@/lib/autoBackupsApi'
import { Clock, RotateCcw, Loader2, X } from 'lucide-react'

interface AutoBackupsBarProps {
  /** Sheet whose auto-backups we list. When undefined (no active sheet, e.g. clinic-wide route),
   *  the button is rendered disabled with a tooltip rather than hidden, so the UI stays consistent. */
  sheetId: string | null
  /** Called when the user clicks "Restore" on a backup row. The parent handles the actual restore
   *  (snapshotting current state, replacing rows, saving to DB, showing the undo toast). */
  onRestore: (backupId: string) => Promise<void>
  /** Force a re-fetch of the version list (e.g. parent saved/triggered a backup and wants the list
   *  to refresh without waiting for the polling interval). Bump to invalidate. */
  refreshKey?: number
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return iso
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.floor(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export default function AutoBackupsBar({ sheetId, onRestore, refreshKey }: AutoBackupsBarProps) {
  const [versions, setVersions] = useState<AutoBackupVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!sheetId) {
      setVersions([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await listAutoBackups(sheetId)
      setVersions(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load auto-backups')
    } finally {
      setLoading(false)
    }
  }, [sheetId])

  // Initial fetch when modal opens, when sheet changes, or when parent bumps refreshKey.
  useEffect(() => {
    if (!modalOpen) return
    void refresh()
  }, [modalOpen, refresh, refreshKey])

  // Light polling while modal is open so a backup created in the background (e.g. another tab
  // switch) shows up without the user having to close + reopen.
  useEffect(() => {
    if (!modalOpen) return
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [modalOpen, refresh])

  const handleRestoreClick = async (backupId: string) => {
    setRestoringId(backupId)
    setError(null)
    try {
      await onRestore(backupId)
      setModalOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={!sheetId}
        title={sheetId ? 'View auto-backups (recent in-session snapshots)' : 'Open a provider sheet to view auto-backups'}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Clock className="w-4 h-4" />
        Auto-backups
      </button>

      {modalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex justify-center bg-black/60 pt-20 pb-4 px-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-gray-900 border border-white/20 rounded-xl shadow-xl max-w-lg w-full p-5 self-start max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Auto-backups</h3>
                <p className="text-white/60 text-xs mt-0.5">
                  Snapshots saved each time you leave this sheet. Last 7 days, newest first.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="overflow-y-auto -mr-2 pr-2 flex-1 min-h-0">
              {loading && versions.length === 0 ? (
                <div className="flex items-center gap-2 text-white/70 text-sm py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading…
                </div>
              ) : versions.length === 0 ? (
                <div className="text-white/50 text-sm py-6 text-center">
                  No auto-backups yet. They're created automatically when you leave a sheet you were editing.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-white text-sm font-medium">{formatRelativeTime(v.created_at)}</span>
                        <span className="text-white/50 text-xs">{formatAbsolute(v.created_at)}{v.user_email ? ` · ${v.user_email}` : ''}</span>
                      </div>
                      <button
                        type="button"
                        disabled={restoringId !== null}
                        onClick={() => handleRestoreClick(v.id)}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {restoringId === v.id ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Restoring…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-3.5 h-3.5" />
                            Restore
                          </>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
