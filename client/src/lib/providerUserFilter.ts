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
  // When `userEmails` is empty (e.g. the caller's role can't read other users' email because of
  // RLS on the `users` table — billing_staff, office_staff, etc.), the original behavior dropped
  // *every* provider because no email could match the empty set, and the sidebar showed "No
  // providers" in every clinic. Treat an empty set as "skip the user-account filter": we still
  // dedupe by email so duplicate provider rows collapse, we just don't require a matching active
  // user login. Admins continue to use the strict filter since the users query returns data for them.
  const matched = userEmails.size === 0
    ? providers.filter(p => normalizeEmail(p.email) !== '')
    : providers.filter(p => {
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
