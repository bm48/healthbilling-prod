import type { SheetRow } from '@/types'

/** Metadata-only entry returned by the list endpoint. `rows` is fetched separately on restore. */
export interface AutoBackupVersion {
  id: string
  created_at: string
  user_id: string | null
  user_email: string | null
}

export interface AutoBackupFull extends AutoBackupVersion {
  sheet_id: string
  rows: SheetRow[]
}

function getApiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
}

function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem('health-billing-auth')
    if (!raw) return null
    const data = JSON.parse(raw) as { currentSession?: { access_token?: string }; access_token?: string }
    return data?.currentSession?.access_token ?? data?.access_token ?? null
  } catch {
    return null
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  if (!token) throw new Error('Not signed in')
  const base = getApiBase()
  const res = await fetch(`${base}${path}`, {
    ...(init ?? {}),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return payload as T
}

/** Write a tab-leave snapshot. Server prunes entries older than 7 days for the same sheet. */
export async function createAutoBackup(sheetId: string, rows: SheetRow[]): Promise<{ id: string; created_at: string }> {
  return jsonFetch('/api/auto-backup-provider-sheet', {
    method: 'POST',
    body: JSON.stringify({ sheetId, rows }),
  })
}

/** List recent backups for a sheet (newest first). Metadata only — fetch one with getAutoBackup. */
export async function listAutoBackups(sheetId: string): Promise<AutoBackupVersion[]> {
  const data = await jsonFetch<{ versions: AutoBackupVersion[] }>(
    `/api/auto-backup-provider-sheet?sheetId=${encodeURIComponent(sheetId)}`,
  )
  return data.versions
}

/** Fetch a single backup with its full rows payload. */
export async function getAutoBackup(backupId: string): Promise<AutoBackupFull> {
  return jsonFetch<AutoBackupFull>(`/api/auto-backup-provider-sheet/${encodeURIComponent(backupId)}`)
}
