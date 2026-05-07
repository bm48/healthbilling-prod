import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
import { env } from '../config.js'
import { pool } from '../db.js'
import {
  runBackupAr,
  runBackupPatients,
  runBackupProviderPay,
  runBackupProviderSheets,
} from '../cron/tabBackupJobs.js'

export const backupCronRoutes = Router()

function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const configured = env.BACKUP_CRON_SECRET
  if (!configured) {
    res.status(503).json({ error: 'BACKUP_CRON_SECRET is not configured' })
    return
  }
  const secret = typeof req.body?.cron_secret === 'string' ? req.body.cron_secret : ''
  if (secret !== configured) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

backupCronRoutes.post('/backup-ar', requireCronSecret, async (_req, res) => {
  try {
    const result = await runBackupAr(pool)
    res.json(result)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cron] backup-ar', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Backup failed' })
  }
})

backupCronRoutes.post('/backup-patients', requireCronSecret, async (_req, res) => {
  try {
    const result = await runBackupPatients(pool)
    res.json(result)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cron] backup-patients', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Backup failed' })
  }
})

backupCronRoutes.post('/backup-provider-pay', requireCronSecret, async (_req, res) => {
  try {
    const result = await runBackupProviderPay(pool)
    res.json(result)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cron] backup-provider-pay', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Backup failed' })
  }
})

backupCronRoutes.post('/backup-provider-sheets', requireCronSecret, async (_req, res) => {
  try {
    const result = await runBackupProviderSheets(pool)
    res.json(result)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[cron] backup-provider-sheets', e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Backup failed' })
  }
})
