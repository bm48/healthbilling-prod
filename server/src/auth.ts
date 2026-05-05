import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { sha256 } from 'js-sha256'
import { v4 as uuidv4 } from 'uuid'
import { pool, ensureServerSchema } from './db.js'
import { env } from './config.js'

export type AuthUser = {
  id: string
  email: string
  role: string
  clinic_ids: string[]
}

export function hashToken(raw: string): string {
  return sha256(raw)
}

function createRefreshTokenRaw(): string {
  // 3 UUIDs without dashes yields 96 hex chars, matching prior randomBytes(48).toString('hex') length.
  return `${uuidv4()}${uuidv4()}${uuidv4()}`.replace(/-/g, '')
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) return false
  return bcrypt.compare(password, hash)
}

export function makeAccessToken(user: AuthUser): string {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    clinic_ids: user.clinic_ids ?? [],
    typ: 'access' as const,
  }
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '1h' })
}

export async function issueRefreshToken(userId: string): Promise<string> {
  await ensureServerSchema()
  const raw = createRefreshTokenRaw()
  const tokenHash = hashToken(raw)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
  await pool.query(
    `INSERT INTO public.server_refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1::uuid, $2, $3)`,
    [userId, tokenHash, expiresAt],
  )
  return raw
}

export async function rotateRefreshToken(rawToken: string): Promise<{ userId: string; refreshToken: string } | null> {
  await ensureServerSchema()
  const tokenHash = hashToken(rawToken)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sel = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM public.server_refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [tokenHash],
    )
    const row = sel.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return null
    }
    await client.query(`UPDATE public.server_refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id])
    const raw = createRefreshTokenRaw()
    const nextHash = hashToken(raw)
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    await client.query(
      `INSERT INTO public.server_refresh_tokens (user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)`,
      [row.user_id, nextHash, expiresAt],
    )
    await client.query('COMMIT')
    return { userId: row.user_id, refreshToken: raw }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await ensureServerSchema()
  const tokenHash = hashToken(rawToken)
  await pool.query(
    `UPDATE public.server_refresh_tokens SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  )
}

export async function resolveSession(accessToken: string | undefined): Promise<AuthUser | null> {
  if (!accessToken) return null
  try {
    const payload = jwt.verify(accessToken, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & {
      typ?: string
      role?: string
      clinic_ids?: string[]
    }
    if (payload.typ !== 'access' || !payload.sub) return null
    const r = await pool.query<{
      id: string
      email: string
      role: string
      clinic_ids: string[] | null
      active: boolean
    }>(
      `SELECT id, email, role, clinic_ids, active FROM public.users WHERE id = $1::uuid LIMIT 1`,
      [payload.sub],
    )
    const profile = r.rows[0]
    if (!profile || profile.active === false) return null
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      clinic_ids: profile.clinic_ids ?? [],
    }
  } catch {
    return null
  }
}

export async function requireAuth(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): Promise<void> {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice('Bearer '.length)
    : undefined
  const user = await resolveSession(bearer)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  req.authUser = user
  next()
}
