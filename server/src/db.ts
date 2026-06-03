import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { env } from './config.js'

export const pool = new Pool({ connectionString: env.DATABASE_URL })

// Idle pooled connections can be terminated by Postgres (server restart,
// pg_terminate_backend, idle_session_timeout). Without this handler the pool
// re-emits 'error' on an EventEmitter with no listener and Node aborts the
// process. The pool itself will discard the dead client and create a new one.
pool.on('error', (err) => {
  console.error('[pg pool] idle client error:', err.message)
})

let schemaReady = false

export async function ensureServerSchema(): Promise<void> {
  if (schemaReady) return
  const sqlPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'bootstrap.sql')
  const sql = await readFile(sqlPath, 'utf8')
  try {
    await pool.query(sql)
    schemaReady = true
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to apply server/sql/bootstrap.sql:', e)
    throw e
  }
}
