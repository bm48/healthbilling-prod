import { createNativeClient, type AppSession, type AppUser } from './nativeClient'

/** Default API client (session key `health-billing-auth`). */
export const apiClient = createNativeClient('health-billing-auth')

export type Session = AppSession
export type User = AppUser

/** Separate storage (e.g. verify-password flow without clobbering main session). */
export function createApiClientWithStorageKey(storageKey: string) {
  return createNativeClient(storageKey)
}

let manualRefreshInProgress = false
let lastManualRefresh = 0

export async function ensureValidSession() {
  const now = Date.now()
  if (now - lastManualRefresh < 30000) return
  if (manualRefreshInProgress) return
  try {
    manualRefreshInProgress = true
    const { error } = await apiClient.auth.refreshSession()
    if (!error) {
      lastManualRefresh = now
    } else {
      console.error('Manual session refresh failed:', error)
    }
  } catch (error) {
    console.error('Manual session refresh error:', error)
  } finally {
    manualRefreshInProgress = false
  }
}
