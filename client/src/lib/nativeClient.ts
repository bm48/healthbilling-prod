/**
 * Browser client for the HealthBilling Node + PostgreSQL API (PostgREST-style query builder).
 */

export type ApiError = { message: string; code?: string; details?: string }

export type AppUser = {
  id: string
  email?: string
  aud?: string
  role?: string
  user_metadata?: { role?: string; full_name?: string; clinic_ids?: string[] }
  app_metadata?: Record<string, unknown>
}

export type AppSession = {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  token_type: string
  user: AppUser
}

type Filter =
  | { op: 'eq'; column: string; value: unknown }
  | { op: 'neq'; column: string; value: unknown }
  | { op: 'in'; column: string; value: unknown[] }
  | { op: 'is'; column: string; value: null | undefined }
  | { op: 'gte'; column: string; value: unknown }
  | { op: 'lte'; column: string; value: unknown }
  | { op: 'lt'; column: string; value: unknown }
  | { op: 'not'; column: string; value: unknown; comparator?: string }
  | { op: 'overlaps'; column: string; value: unknown }
  | { op: 'contains'; column: string; value: unknown }

/** `data` is intentionally loose — rows match your Postgres `public` tables. */
export type PostgrestResponse = {
  data: any
  error: ApiError | null
  count?: number | null
}

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
}

function readPersistedSession(storageKey: string): AppSession | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      currentSession?: AppSession
      access_token?: string
      refresh_token?: string
      expires_at?: number
      user?: AppUser
    }
    const s = parsed.currentSession ?? (parsed.access_token ? (parsed as AppSession) : null)
    if (!s?.access_token) return null
    return {
      access_token: s.access_token,
      refresh_token: s.refresh_token ?? parsed.refresh_token ?? '',
      expires_at: s.expires_at ?? parsed.expires_at,
      expires_in: s.expires_in,
      token_type: s.token_type ?? 'bearer',
      user: s.user ?? parsed.user ?? { id: '', email: '' },
    }
  } catch {
    return null
  }
}

function writePersistedSession(storageKey: string, session: AppSession | null): void {
  if (!session) {
    localStorage.removeItem(storageKey)
    return
  }
  const blob = {
    currentSession: session,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  }
  localStorage.setItem(storageKey, JSON.stringify(blob))
}

type AuthListener = (event: string, session: AppSession | null) => void

export class PostgrestBuilder implements Promise<PostgrestResponse> {
  readonly [Symbol.toStringTag] = 'Promise'

  private table = ''
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private selectColumns = '*'
  private selectOptions?: { count?: 'exact'; head?: boolean }
  private filters: Filter[] = []
  private orders: { column: string; ascending: boolean }[] = []
  private limitN?: number
  private insertPayload?: Record<string, unknown> | Record<string, unknown>[]
  private updatePayload?: Record<string, unknown>
  private upsertOnConflict?: string
  private flagSingle = false
  private flagMaybeSingle = false
  private flagHead = false

  constructor(
    private readonly getAccessToken: () => string | null,
    _storageKey: string,
    table: string,
  ) {
    this.table = table
  }

  select(columns = '*', opts?: { count?: 'exact'; head?: boolean }): this {
    this.selectColumns = columns
    this.selectOptions = opts
    return this
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.action = 'insert'
    this.insertPayload = values
    return this
  }

  update(values: Record<string, unknown>): this {
    this.action = 'update'
    this.updatePayload = values
    return this
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.action = 'upsert'
    this.insertPayload = Array.isArray(values) ? values : [values]
    this.upsertOnConflict = options?.onConflict
    void options?.ignoreDuplicates
    return this
  }

  delete(): this {
    this.action = 'delete'
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ op: 'eq', column, value })
    return this
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ op: 'neq', column, value })
    return this
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ op: 'in', column, value: values })
    return this
  }

  is(column: string, value: null): this {
    this.filters.push({ op: 'is', column, value })
    return this
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ op: 'gte', column, value })
    return this
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ op: 'lte', column, value })
    return this
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ op: 'lt', column, value })
    return this
  }

  not(column: string, op: string, value: unknown): this {
    this.filters.push({ op: 'not', column, value, comparator: op })
    return this
  }

  overlaps(column: string, value: unknown): this {
    this.filters.push({ op: 'overlaps', column, value })
    return this
  }

  contains(column: string, value: unknown[]): this {
    this.filters.push({ op: 'contains', column, value })
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: opts?.ascending !== false })
    return this
  }

  limit(n: number): this {
    this.limitN = n
    return this
  }

  single(): this {
    this.flagSingle = true
    this.flagMaybeSingle = false
    return this
  }

  maybeSingle(): this {
    this.flagMaybeSingle = true
    this.flagSingle = false
    return this
  }

  head(): this {
    this.flagHead = true
    return this
  }

  private mapFilters(): Filter[] {
    return this.filters
  }

  private async run(): Promise<PostgrestResponse> {
    const token = this.getAccessToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    const base = apiBase()

    if (this.action === 'select') {
      const body = {
        table: this.table,
        action: 'select' as const,
        select: this.selectColumns,
        filters: this.mapFilters(),
        orders: this.orders,
        limit: this.limitN,
        single: this.flagSingle,
        maybeSingle: this.flagMaybeSingle,
        head: this.selectOptions?.head ?? this.flagHead,
        count: this.selectOptions?.count,
      }
      const res = await fetch(`${base}/api/db/query`, { method: 'POST', headers, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => ({}))) as {
        data?: any
        count?: number | null
        error?: { message?: string }
      }
      if (res.status === 406) {
        return { data: null, error: { message: json.error?.message ?? 'Not found', code: 'PGRST116' }, count: null }
      }
      if (!res.ok) {
        return { data: null, error: { message: json.error?.message ?? res.statusText, code: String(res.status) }, count: null }
      }
      if (json.error?.message) {
        return { data: null, error: { message: json.error.message }, count: null }
      }
      return { data: json.data ?? null, error: null, count: json.count ?? null }
    }

    if (this.action === 'insert') {
      const values = this.insertPayload
      if (values == null) {
        return { data: null, error: { message: 'Missing insert payload' }, count: null }
      }
      const row = Array.isArray(values) ? (values[0] as Record<string, unknown> | undefined) : (values as Record<string, unknown>)
      if (!row) {
        return { data: null, error: { message: 'Empty insert rows' }, count: null }
      }
      const body = {
        table: this.table,
        action: 'insert' as const,
        values: row,
        single: this.flagSingle,
        maybeSingle: this.flagMaybeSingle,
      }
      const res = await fetch(`${base}/api/db/query`, { method: 'POST', headers, body: JSON.stringify(body) })
      return parseWriteResponse(res)
    }

    if (this.action === 'update') {
      const body = {
        table: this.table,
        action: 'update' as const,
        values: this.updatePayload ?? {},
        filters: this.mapFilters(),
        single: this.flagSingle,
        maybeSingle: this.flagMaybeSingle,
      }
      const res = await fetch(`${base}/api/db/query`, { method: 'POST', headers, body: JSON.stringify(body) })
      return parseWriteResponse(res)
    }

    if (this.action === 'delete') {
      const body = {
        table: this.table,
        action: 'delete' as const,
        filters: this.mapFilters(),
        single: this.flagSingle,
        maybeSingle: this.flagMaybeSingle,
      }
      const res = await fetch(`${base}/api/db/query`, { method: 'POST', headers, body: JSON.stringify(body) })
      return parseWriteResponse(res)
    }

    if (this.action === 'upsert') {
      const rows = Array.isArray(this.insertPayload)
        ? this.insertPayload
        : this.insertPayload
          ? [this.insertPayload as Record<string, unknown>]
          : []
      const body = {
        table: this.table,
        action: 'upsert' as const,
        rows,
        onConflict: this.upsertOnConflict,
        single: this.flagSingle,
        maybeSingle: this.flagMaybeSingle,
      }
      const res = await fetch(`${base}/api/db/query`, { method: 'POST', headers, body: JSON.stringify(body) })
      return parseWriteResponse(res)
    }

    return { data: null, error: { message: 'Unsupported operation' }, count: null }
  }

  then<TResult1 = PostgrestResponse, TResult2 = never>(
    onfulfilled?: ((value: PostgrestResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled as never, onrejected as never)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<PostgrestResponse | TResult> {
    return this.run().catch(onrejected ?? undefined)
  }

  finally(onfinally?: (() => void) | null): Promise<PostgrestResponse> {
    return this.run().finally(onfinally ?? undefined)
  }
}

async function parseWriteResponse(res: Response): Promise<PostgrestResponse> {
  const json = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { message?: string } }
  if (!res.ok) {
    return { data: null, error: { message: json.error?.message ?? res.statusText, code: String(res.status) }, count: null }
  }
  if (json.error?.message) {
    return { data: null, error: { message: json.error.message }, count: null }
  }
  return { data: json.data ?? null, error: null, count: null }
}

class StorageBucket {
  constructor(
    private readonly bucket: string,
    private readonly getAccessToken: () => string | null,
  ) {}

  async createSignedUrl(
    path: string,
    expiresIn: number,
    _options?: { download?: boolean },
  ): Promise<{ data: { signedUrl: string } | null; error: ApiError | null }> {
    const token = this.getAccessToken()
    if (!token) return { data: null, error: { message: 'Not authenticated' } }
    const base = apiBase()
    const res = await fetch(`${base}/api/storage/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bucket: this.bucket, path, expiresIn }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      data?: { signedUrl?: string }
      error?: string
    }
    if (!res.ok) {
      return { data: null, error: { message: (json as { error?: string }).error ?? res.statusText } }
    }
    const url = json.data?.signedUrl
    if (!url) return { data: null, error: { message: 'No signed URL in response' } }
    return { data: { signedUrl: url }, error: null }
  }

  async download(path: string): Promise<{ data: Blob | null; error: ApiError | null }> {
    const token = this.getAccessToken()
    if (!token) return { data: null, error: { message: 'Not authenticated' } }
    const base = apiBase()
    const q = new URLSearchParams({ bucket: this.bucket, path })
    const res = await fetch(`${base}/api/storage/download-file?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      return { data: null, error: { message: await res.text().catch(() => res.statusText) } }
    }
    const blob = await res.blob()
    return { data: blob, error: null }
  }
}

export class NativeClient {
  readonly auth: {
    getSession: () => Promise<{ data: { session: AppSession | null }; error: ApiError | null }>
    signInWithPassword: (creds: {
      email: string
      password: string
    }) => Promise<{ data: { session: AppSession | null; user: AppUser | null }; error: ApiError | null }>
    signUp: (creds: {
      email: string
      password: string
      options?: { data?: Record<string, unknown> }
    }) => Promise<{ data: { user: AppUser | null }; error: ApiError | null }>
    adminCreateUser: (params: {
      email: string
      password: string
      full_name?: string
      role?: string
    }) => Promise<{ data: { user: AppUser | null }; error: ApiError | null }>
    signOut: () => Promise<{ error: ApiError | null }>
    onAuthStateChange: (cb: AuthListener) => { data: { subscription: { unsubscribe: () => void } } }
    refreshSession: () => Promise<{ data: { session: AppSession | null }; error: ApiError | null }>
    updateUser: (attrs: { password?: string; current_password?: string }) => Promise<{ error: ApiError | null }>
  }

  readonly storage = {
    from: (bucket: string) => new StorageBucket(bucket, () => this.getAccessToken()),
  }

  private listeners = new Set<AuthListener>()

  constructor(private readonly storageKey: string) {
    const emit = (event: string, session: AppSession | null) => {
      this.listeners.forEach((l) => {
        try {
          l(event, session)
        } catch {
          /* ignore */
        }
      })
    }
    this.auth = {
      getSession: async () => {
        const session = readPersistedSession(this.storageKey)
        return { data: { session }, error: null }
      },
      signInWithPassword: async ({ email, password }) => {
        const base = apiBase()
        const res = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          session?: AppSession
          error?: string
        }
        if (!res.ok) {
          return {
            data: { session: null, user: null },
            error: { message: json.error ?? 'Login failed', code: 'invalid_credentials' },
          }
        }
        const s = json.session
        if (!s?.access_token) {
          return { data: { session: null, user: null }, error: { message: 'Invalid server response' } }
        }
        const session: AppSession = {
          access_token: s.access_token,
          refresh_token: s.refresh_token ?? '',
          expires_at: s.expires_at,
          expires_in: s.expires_in,
          token_type: s.token_type ?? 'bearer',
          user: {
            id: s.user?.id ?? '',
            email: s.user?.email,
            user_metadata: s.user?.user_metadata,
          },
        }
        writePersistedSession(this.storageKey, session)
        emit('SIGNED_IN', session)
        return { data: { session, user: session.user }, error: null }
      },
      signUp: async ({ email, password, options }) => {
        const base = apiBase()
        const res = await fetch(`${base}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            full_name: String(options?.data?.full_name ?? ''),
            role: String(options?.data?.role ?? 'provider'),
          }),
        })
        const json = (await res.json().catch(() => ({}))) as { user?: AppUser; error?: string }
        if (!res.ok) {
          return { data: { user: null }, error: { message: json.error ?? 'Sign up failed' } }
        }
        const u = json.user
        return {
          data: {
            user: u
              ? { id: u.id, email: u.email, user_metadata: (u as AppUser).user_metadata ?? (u as { user_metadata?: AppUser['user_metadata'] }).user_metadata }
              : null,
          },
          error: null,
        }
      },
      adminCreateUser: async (params) => {
        const token = this.getAccessToken()
        if (!token) return { data: { user: null }, error: { message: 'Not authenticated' } }
        const base = apiBase()
        const res = await fetch(`${base}/api/auth/admin-create-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(params),
        })
        const json = (await res.json().catch(() => ({}))) as { user?: AppUser; error?: string }
        if (!res.ok) {
          return { data: { user: null }, error: { message: json.error ?? 'Failed to create user' } }
        }
        const u = json.user
        return {
          data: {
            user: u ? { id: u.id, email: u.email, user_metadata: (u as AppUser).user_metadata } : null,
          },
          error: null,
        }
      },
      signOut: async () => {
        const s = readPersistedSession(this.storageKey)
        const base = apiBase()
        try {
          await fetch(`${base}/api/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: s?.refresh_token ?? '' }),
          })
        } catch {
          /* ignore */
        }
        writePersistedSession(this.storageKey, null)
        emit('SIGNED_OUT', null)
        return { error: null }
      },
      onAuthStateChange: (cb: AuthListener) => {
        this.listeners.add(cb)
        queueMicrotask(async () => {
          const { data } = await this.auth.getSession()
          cb('INITIAL_SESSION', data.session)
        })
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                this.listeners.delete(cb)
              },
            },
          },
        }
      },
      refreshSession: async () => {
        const s = readPersistedSession(this.storageKey)
        if (!s?.refresh_token) {
          return { data: { session: null }, error: { message: 'No refresh token' } }
        }
        const base = apiBase()
        const res = await fetch(`${base}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: s.refresh_token }),
        })
        const json = (await res.json().catch(() => ({}))) as { session?: AppSession; error?: string }
        if (!res.ok || !json.session?.access_token) {
          writePersistedSession(this.storageKey, null)
          return { data: { session: null }, error: { message: json.error ?? 'Refresh failed' } }
        }
        const next: AppSession = {
          access_token: json.session.access_token,
          refresh_token: json.session.refresh_token ?? s.refresh_token,
          expires_at: json.session.expires_at,
          expires_in: json.session.expires_in,
          token_type: json.session.token_type ?? 'bearer',
          user: {
            id: json.session.user?.id ?? s.user.id,
            email: json.session.user?.email ?? s.user.email,
            user_metadata: json.session.user?.user_metadata ?? s.user.user_metadata,
          },
        }
        writePersistedSession(this.storageKey, next)
        emit('TOKEN_REFRESHED', next)
        return { data: { session: next }, error: null }
      },
      updateUser: async (attrs) => {
        const token = this.getAccessToken()
        if (!token) return { error: { message: 'Not authenticated' } }
        if (attrs.password && attrs.current_password) {
          const base = apiBase()
          const res = await fetch(`${base}/api/auth/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              current_password: attrs.current_password,
              new_password: attrs.password,
            }),
          })
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string }
            return { error: { message: j.error ?? (await res.text()) } }
          }
          return { error: null }
        }
        return { error: { message: 'Unsupported updateUser fields' } }
      },
    }
  }

  getAccessToken(): string | null {
    return readPersistedSession(this.storageKey)?.access_token ?? null
  }

  from(table: string): PostgrestBuilder {
    return new PostgrestBuilder(() => this.getAccessToken(), this.storageKey, table)
  }

  /** After sign-in, records a provider_login row when the user matches a provider by email. */
  async recordProviderLogin(): Promise<void> {
    const token = this.getAccessToken()
    if (!token) return
    const base = apiBase()
    await fetch(`${base}/api/auth/record-provider-login`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }
}

export function createNativeClient(storageKey: string): NativeClient {
  return new NativeClient(storageKey)
}
