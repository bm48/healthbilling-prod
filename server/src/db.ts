import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { env } from './config.js'

export const pool = new Pool({ connectionString: env.DATABASE_URL })
console.log('DATABASE_URL', env.DATABASE_URL)
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
