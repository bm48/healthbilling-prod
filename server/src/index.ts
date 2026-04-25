import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { env } from './config.js'
import { ensureServerSchema } from './db.js'
import { authRoutes } from './routes/authRoutes.js'
import { queryRoutes } from './routes/queryRoutes.js'
import { serviceRoutes } from './routes/serviceRoutes.js'
import { ensureStorageRoot, storageRoutes } from './routes/storageRoutes.js'

const app = express()
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ ok: true, database: 'amerbilling' })
})

app.use('/api', serviceRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/db', queryRoutes)
app.use('/api/storage', storageRoutes)

async function main() {
  await ensureServerSchema()
  await ensureStorageRoot()
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`health-billing-server listening on http://localhost:${env.PORT}`)
  })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
