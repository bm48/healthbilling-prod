import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { createReadStream } from 'node:fs'
import { access, constants, mkdir } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../config.js'
import { requireAuth } from '../auth.js'

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STORAGE_ROOT = process.env.STORAGE_ROOT
  ? resolve(process.env.STORAGE_ROOT)
  : join(serverDir, 'storage-data')

const router = Router()

function safeStoragePath(bucket: string, objectPath: string): string {
  const b = normalize(bucket).replace(/^(\.\.(\/|\\|$))+/, '')
  const p = normalize(objectPath).replace(/^(\.\.(\/|\\|$))+/, '')
  if (b.includes('..') || p.includes('..')) throw new Error('Invalid path')
  const full = join(STORAGE_ROOT, b, p)
  const root = resolve(STORAGE_ROOT)
  if (!full.startsWith(root)) throw new Error('Path escape')
  return full
}

async function ensureDirFor(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
}

export async function ensureStorageRoot(): Promise<void> {
  await mkdir(STORAGE_ROOT, { recursive: true })
}

/** Super-admin or authenticated backup flows: issue short-lived download token. */
router.post('/sign', requireAuth, async (req, res) => {
  try {
    const bucket = String(req.body?.bucket ?? '')
    const path = String(req.body?.path ?? '')
    const expiresIn = Math.min(Number(req.body?.expiresIn) || 60, 3600)
    if (!bucket || !path) {
      res.status(400).json({ error: 'bucket and path are required' })
      return
    }
    safeStoragePath(bucket, path) // validate only
    const token = jwt.sign(
      { typ: 'storage', b: bucket, p: path },
      env.JWT_ACCESS_SECRET,
      { expiresIn: `${expiresIn}s` },
    )
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    const base =
      origin ||
      `${req.protocol}://${req.get('host')}`
    const signedUrl = `${base}/api/storage/file?token=${encodeURIComponent(token)}`
    res.json({ data: { signedUrl, path: signedUrl }, error: null })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid request' })
  }
})

/** Download using signed token (no Authorization header). */
router.get('/file', async (req, res) => {
  try {
    const token = String(req.query.token ?? '')
    if (!token) {
      res.status(400).send('Missing token')
      return
    }
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & {
      typ?: string
      b?: string
      p?: string
    }
    if (payload.typ !== 'storage' || !payload.b || !payload.p) {
      res.status(403).send('Invalid token')
      return
    }
    const diskPath = safeStoragePath(payload.b, payload.p)
    try {
      await access(diskPath, constants.R_OK)
    } catch {
      res.status(404).send('Not found')
      return
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${payload.p.split('/').pop() ?? 'file'}"`)
    createReadStream(diskPath).pipe(res)
  } catch {
    res.status(403).send('Invalid or expired token')
  }
})

/** Authenticated download (Authorization Bearer). */
router.get('/download-file', requireAuth, async (req, res) => {
  try {
    const bucket = String(req.query.bucket ?? '')
    const path = String(req.query.path ?? '')
    if (!bucket || !path) {
      res.status(400).send('bucket and path required')
      return
    }
    const diskPath = safeStoragePath(bucket, path)
    try {
      await access(diskPath, constants.R_OK)
    } catch {
      res.status(404).send('Not found')
      return
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    createReadStream(diskPath).pipe(res)
  } catch (e) {
    res.status(400).send(e instanceof Error ? e.message : 'Bad request')
  }
})

export { router as storageRoutes, STORAGE_ROOT, ensureDirFor, safeStoragePath }
