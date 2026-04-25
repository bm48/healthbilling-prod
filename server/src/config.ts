import { config as loadEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: resolve(serverDir, '..', '.env') })
loadEnv({ path: resolve(serverDir, '.env'), override: true })
loadEnv({ path: resolve(serverDir, '.env.local'), override: true })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_REFRESH_SECRET: z.string().min(24),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Inbox for public contact form (e.g. admin@example.com). */
  CONTACT_TO_EMAIL: z.string().email().default('admin@amerbilling.com'),
  /** Gmail (or other SMTP) — optional; required for contact form and invite emails. */
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
})

export const env = envSchema.parse(process.env)
