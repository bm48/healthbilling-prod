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

// In dev, log every /api hit so you can confirm traffic reaches this process (vs watching the Vite terminal only).
if (env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      // eslint-disable-next-line no-console
      console.log('[http]', req.method, req.originalUrl)
    }
    next()
  })
}

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
  const server = app.listen(env.PORT)
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(
        `[server] Port ${env.PORT} is already in use. Stop the other process or set PORT in server/.env to a free port (e.g. 4001).`,
      )
      process.exit(1)
      return
    }
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
  server.once('listening', () => {
    // eslint-disable-next-line no-console
    console.log(
      `[server] listening pid=${process.pid} port=${env.PORT} env=${env.NODE_ENV} — health: http://localhost:${env.PORT}/health`,
    )
    if (env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(
        '[server] tip: run the API from the server/ folder (npm run dev). Run the Vite app separately in client/ (npm run dev); contact-form logs appear here, not in the browser console.',
      )
    }
  })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
