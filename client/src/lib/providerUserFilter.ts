import { apiClient } from '@/lib/apiClient'
import type { Provider } from '@/types'

export interface ProviderUserDedupResult {
  displayedProviders: Provider[]
  providerIdToCanonical: Record<string, string>
}

const normalizeEmail = (email: string | null | undefined): string =>
  (email ?? '').trim().toLowerCase()

export async function fetchActiveProviderUserEmails(): Promise<Set<string>> {
  const { data } = await apiClient
    .from('users')
    .select('email')
    .eq('active', true)
    .eq('role', 'provider')
  const set = new Set<string>()
  for (const row of (data || []) as Array<{ email?: string | null }>) {
    const e = normalizeEmail(row.email)
    if (e) set.add(e)
  }
  return set
}

/**
 * Filter providers to those whose email matches an active provider user,
 * then dedupe by email (first occurrence wins).
 *
 * Returns the displayed list plus a map from every underlying provider_id to
 * the displayed (canonical) provider_id, so callers can re-attribute billing
 * data attached to suppressed duplicate rows.
 */
export function dedupeProvidersByUser(
  providers: Provider[],
  userEmails: Set<string>
): ProviderUserDedupResult {
  const matched = providers.filter(p => {
    const email = normalizeEmail(p.email)
    return email !== '' && userEmails.has(email)
  })

  const canonicalByEmail = new Map<string, Provider>()
  for (const p of matched) {
    const email = normalizeEmail(p.email)
    if (!canonicalByEmail.has(email)) canonicalByEmail.set(email, p)
  }

  const providerIdToCanonical: Record<string, string> = {}
  for (const p of matched) {
    const canonical = canonicalByEmail.get(normalizeEmail(p.email))
    if (canonical) providerIdToCanonical[p.id] = canonical.id
  }

  return {
    displayedProviders: Array.from(canonicalByEmail.values()),
    providerIdToCanonical,
  }
}
