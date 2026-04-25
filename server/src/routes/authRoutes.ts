import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { pool } from '../db.js'
import { env } from '../config.js'
import {
  issueRefreshToken,
  makeAccessToken,
  requireAuth,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyPassword,
} from '../auth.js'

export const authRoutes = Router()

type PublicUserRow = {
  id: string
  email: string
  full_name: string | null
  role: string
  clinic_ids: string[] | null
  highlight_color: string | null
  hourly_pay: string | null
  active: boolean
  created_at: Date
  updated_at: Date
}

const ASSIGNABLE_ROLES = new Set([
  'super_admin',
  'admin',
  'view_only_admin',
  'billing_staff',
  'view_only_billing',
  'provider',
  'office_staff',
  'official_staff',
])

authRoutes.get('/session', async (req, res) => {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice('Bearer '.length)
    : undefined
  if (!bearer) {
    res.json({ session: null })
    return
  }
  try {
    const payload = jwt.verify(bearer, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & { typ?: string }
    if (payload.typ !== 'access' || !payload.sub) {
      res.json({ session: null })
      return
    }
    const profile = await pool.query<PublicUserRow>(
      `SELECT id, email, full_name, role, clinic_ids, active FROM public.users WHERE id = $1::uuid LIMIT 1`,
      [payload.sub],
    )
    const row = profile.rows[0]
    if (!row || row.active === false) {
      res.json({ session: null })
      return
    }
    res.json({
      session: {
        access_token: bearer,
        token_type: 'bearer',
        expires_at: payload.exp ?? null,
        user: {
          id: row.id,
          email: row.email,
          user_metadata: {
            role: row.role,
            full_name: row.full_name ?? '',
            clinic_ids: row.clinic_ids ?? [],
          },
        },
      },
    })
  } catch {
    res.json({ session: null })
  }
})

authRoutes.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }
  const creds = await pool.query<{
    id: string
    email: string
    password: string | null
  }>(
    `SELECT id, email, password
     FROM public.users
     WHERE lower(trim(email)) = lower(trim($1))
     LIMIT 1`,
    [email],
  )
  const row = creds.rows[0]
  if (!row?.password) {
    res.status(401).json({ error: 'Invalid credentials.' })
    return
  }
  const ok = await verifyPassword(password, row.password)
  if (!ok) {
    res.status(401).json({ error: 'Invalid credentials.' })
    return
  }
  const profile = await pool.query<PublicUserRow>(
    `SELECT id, email, full_name, role, clinic_ids, active FROM public.users WHERE id = $1::uuid LIMIT 1`,
    [row.id],
  )
  const u = profile.rows[0]
  if (!u || u.active === false) {
    res.status(403).json({ error: 'Account is deactivated or profile is missing.' })
    return
  }
  const authUser = {
    id: u.id,
    email: u.email,
    role: u.role,
    clinic_ids: u.clinic_ids ?? [],
  }
  const accessToken = makeAccessToken(authUser)
  const refreshToken = await issueRefreshToken(u.id)
  res.json({
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: u.id,
        email: u.email,
        user_metadata: {
          role: u.role,
          full_name: u.full_name ?? '',
          clinic_ids: u.clinic_ids ?? [],
        },
      },
    },
  })
})

authRoutes.post('/refresh', async (req, res) => {
  const refreshToken = String(req.body?.refresh_token ?? '')
  if (!refreshToken) {
    res.status(400).json({ error: 'refresh_token is required.' })
    return
  }
  const next = await rotateRefreshToken(refreshToken)
  if (!next) {
    res.status(401).json({ error: 'Invalid refresh token.' })
    return
  }
  const profile = await pool.query<PublicUserRow>(
    `SELECT id, email, full_name, role, clinic_ids, active FROM public.users WHERE id = $1::uuid LIMIT 1`,
    [next.userId],
  )
  const row = profile.rows[0]
  if (!row) {
    res.status(401).json({ error: 'User missing.' })
    return
  }
  const accessToken = makeAccessToken({
    id: row.id,
    email: row.email,
    role: row.role,
    clinic_ids: row.clinic_ids ?? [],
  })
  res.json({
    session: {
      access_token: accessToken,
      refresh_token: next.refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: row.id,
        email: row.email,
        user_metadata: {
          role: row.role,
          full_name: row.full_name ?? '',
          clinic_ids: row.clinic_ids ?? [],
        },
      },
    },
  })
})

authRoutes.post('/signup', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const fullName = String(req.body?.full_name ?? '').trim()
  const role = String(req.body?.role ?? 'provider').trim()
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }
  if (!ASSIGNABLE_ROLES.has(role) || role === 'super_admin') {
    res.status(400).json({ error: 'Invalid role for sign up.' })
    return
  }
  const dup = await pool.query(`SELECT 1 FROM public.users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`, [email])
  if (dup.rowCount) {
    res.status(409).json({ error: 'Email already exists.' })
    return
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const id = randomUUID()
  try {
    await pool.query(
      `INSERT INTO public.users (
        id, email, full_name, role, clinic_ids, password, active, highlight_color
      ) VALUES (
        $1::uuid, $2, $3, $4, '{}'::uuid[], $5, true, '#eab308'::text
      )`,
      [id, email, fullName || null, role, passwordHash],
    )
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === '23505') {
      res.status(409).json({ error: 'Email already exists.' })
      return
    }
    throw e
  }
  const profile = await pool.query<Pick<PublicUserRow, 'id' | 'email' | 'full_name' | 'role' | 'clinic_ids'>>(
    `SELECT id, email, full_name, role, clinic_ids FROM public.users WHERE id = $1::uuid`,
    [id],
  )
  const row = profile.rows[0]
  if (!row) {
    res.status(500).json({ error: 'User profile was not created.' })
    return
  }
  res.status(201).json({
    user: {
      id: row.id,
      email: row.email,
      user_metadata: {
        role: row.role,
        full_name: row.full_name ?? '',
        clinic_ids: row.clinic_ids ?? [],
      },
    },
  })
})

authRoutes.post('/admin-create-user', requireAuth, async (req, res) => {
  if (req.authUser!.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden.' })
    return
  }
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const fullName = String(req.body?.full_name ?? '').trim()
  const role = String(req.body?.role ?? 'billing_staff')
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }
  if (!ASSIGNABLE_ROLES.has(role) || role === 'super_admin') {
    res.status(400).json({ error: 'Invalid role for new user.' })
    return
  }
  const dup = await pool.query(`SELECT 1 FROM public.users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`, [email])
  if (dup.rowCount) {
    res.status(409).json({ error: 'Email already exists.' })
    return
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const id = randomUUID()
  try {
    await pool.query(
      `INSERT INTO public.users (
        id, email, full_name, role, clinic_ids, password, active, highlight_color
      ) VALUES (
        $1::uuid, $2, $3, $4, '{}'::uuid[], $5, true, '#eab308'::text
      )`,
      [id, email, fullName || null, role, passwordHash],
    )
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === '23505') {
      res.status(409).json({ error: 'Email already exists.' })
      return
    }
    throw e
  }
  const profile = await pool.query<Pick<PublicUserRow, 'id' | 'email' | 'full_name' | 'role' | 'clinic_ids'>>(
    `SELECT id, email, full_name, role, clinic_ids FROM public.users WHERE id = $1::uuid`,
    [id],
  )
  const row = profile.rows[0]
  if (!row) {
    res.status(500).json({ error: 'User profile was not created.' })
    return
  }
  res.status(201).json({
    user: {
      id: row.id,
      email: row.email,
      user_metadata: {
        role: row.role,
        full_name: row.full_name ?? '',
        clinic_ids: row.clinic_ids ?? [],
      },
    },
  })
})

authRoutes.post('/admin-update-password', requireAuth, async (req, res) => {
  if (req.authUser!.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden: super admin only' })
    return
  }
  const userId = String(req.body?.userId ?? '').trim()
  const newPassword = String(req.body?.newPassword ?? '').trim()
  if (!userId || !newPassword) {
    res.status(400).json({ error: 'Missing userId or newPassword' })
    return
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' })
    return
  }
  const target = await pool.query<{ role: string }>(`SELECT role FROM public.users WHERE id = $1::uuid LIMIT 1`, [userId])
  const tr = target.rows[0]
  if (!tr) {
    res.status(404).json({ error: 'User not found.' })
    return
  }
  if (tr.role === 'super_admin' && userId !== req.authUser!.id) {
    res.status(403).json({ error: 'Cannot change another super admin password.' })
    return
  }
  const newHash = await bcrypt.hash(newPassword, 10)
  await pool.query(`UPDATE public.users SET password = $1, updated_at = now() WHERE id = $2::uuid`, [newHash, userId])
  res.json({ success: true })
})

authRoutes.post('/record-provider-login', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO public.provider_logins (provider_id, logged_at)
       SELECT p.id, now()
       FROM public.providers p
       INNER JOIN public.users u ON lower(trim(u.email)) = lower(trim(p.email))
       WHERE u.id = $1::uuid
       LIMIT 1`,
      [req.authUser!.id],
    )
  } catch {
    /* ignore duplicate or constraint errors */
  }
  res.json({ ok: true })
})

authRoutes.post('/password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.current_password ?? '')
  const newPassword = String(req.body?.new_password ?? '')
  if (!currentPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'current_password and new_password (min 6 chars) are required.' })
    return
  }
  const uid = req.authUser!.id
  const cred = await pool.query<{ password: string | null }>(
    `SELECT password FROM public.users WHERE id = $1::uuid LIMIT 1`,
    [uid],
  )
  const hash = cred.rows[0]?.password
  if (!(await verifyPassword(currentPassword, hash))) {
    res.status(401).json({ error: 'Current password is incorrect.' })
    return
  }
  const newHash = await bcrypt.hash(newPassword, 10)
  await pool.query(`UPDATE public.users SET password = $1, updated_at = now() WHERE id = $2::uuid`, [newHash, uid])
  res.status(204).send()
})

authRoutes.post('/logout', async (req, res) => {
  const refreshToken = String(req.body?.refresh_token ?? '')
  if (refreshToken) {
    await revokeRefreshToken(refreshToken)
  }
  res.status(204).send()
})

authRoutes.get('/me', requireAuth, async (req, res) => {
  const userId = req.authUser!.id
  const r = await pool.query<PublicUserRow>(
    `SELECT id, email, full_name, role, clinic_ids, highlight_color, hourly_pay, active, created_at, updated_at
     FROM public.users WHERE id = $1::uuid LIMIT 1`,
    [userId],
  )
  const user = r.rows[0]
  if (!user) {
    res.status(404).json({ error: 'User not found.' })
    return
  }
  res.json({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    clinic_ids: user.clinic_ids ?? [],
    highlight_color: user.highlight_color,
    hourly_pay: user.hourly_pay,
    active: user.active,
    created_at: user.created_at,
    updated_at: user.updated_at,
  })
})
