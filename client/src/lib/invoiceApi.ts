/** Invoice recompute API helpers (super-admin maintenance). */

export function getApiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
}

export function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem('health-billing-auth')
    if (!raw) return null
    const data = JSON.parse(raw) as {
      currentSession?: { access_token?: string }
      access_token?: string
    }
    return data?.currentSession?.access_token ?? data?.access_token ?? null
  } catch {
    return null
  }
}

async function postInvoiceApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = getAuthToken()
  if (!token) throw new Error('Not signed in')
  const base = getApiBase()
  const res = await fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`)
  }
  return data as T
}

export async function recomputeInvoicesForMonth(month: number, year: number): Promise<{ total: number; failed: number }> {
  const data = await postInvoiceApi<{ total: number; failed: number }>('recompute-invoices-for-month', { month, year })
  return { total: data.total ?? 0, failed: data.failed ?? 0 }
}

export async function recomputeAllInvoices(): Promise<{ total: number; failed: number }> {
  const data = await postInvoiceApi<{ total: number; failed: number }>('recompute-all-invoices', {})
  return { total: data.total ?? 0, failed: data.failed ?? 0 }
}

export async function upsertClinicInvoice(clinicId: string, month: number, year: number): Promise<void> {
  await postInvoiceApi('upsert-clinic-invoice', { clinicId, month, year })
}
