import jwt from 'jsonwebtoken'
import { env } from './config.js'

/** Returns `sub` from a valid access JWT, or null. */
export function getUserIdFromBearer(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & { typ?: string }
    if (p.typ !== 'access' || typeof p.sub !== 'string') return null
    return p.sub
  } catch {
    return null
  }
}
