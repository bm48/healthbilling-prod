import { Router } from 'express'
import nodemailer from 'nodemailer'
import { pool } from '../db.js'
import { env } from '../config.js'
import { getUserIdFromBearer } from '../accessToken.js'

export const serviceRoutes = Router()

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function createMailTransport() {
  const user = env.GMAIL_USER
  const pass = env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  })
}

/** selectedMonthKey: "2025-3" or "2025-3-2" -> { year, month, payroll } */
function parseMonthKey(selectedMonthKey: string): { year: number; month: number; payroll: number } | null {
  const parts = selectedMonthKey.split('-').map((p) => parseInt(p, 10))
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
  const year = parts[0]
  const month = parts[1]
  const payroll = parts.length >= 3 && Number.isFinite(parts[2]) ? parts[2] : 1
  return { year, month, payroll }
}

function rowToDbPayload(
  row: Record<string, unknown>,
  sheetId: string,
  sortOrder: number,
): Record<string, unknown> {
  const get = (k: string) => (row[k] === undefined || row[k] === 'null' ? null : row[k])
  const num = (k: string) => {
    const v = row[k]
    if (v == null || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    return Number.isNaN(n) ? null : n
  }
  return {
    sheet_id: sheetId,
    sort_order: sortOrder,
    patient_id: get('patient_id'),
    appointment_date: get('appointment_date'),
    appointment_time: get('appointment_time'),
    visit_type: get('visit_type'),
    notes: get('notes'),
    billing_code: get('billing_code'),
    billing_code_color: get('billing_code_color'),
    cpt_code: get('cpt_code'),
    cpt_code_color: get('cpt_code_color'),
    appointment_status: get('appointment_status'),
    appointment_status_color: get('appointment_status_color'),
    claim_status: get('claim_status'),
    claim_status_color: get('claim_status_color'),
    submit_date: get('submit_date'),
    insurance_payment: get('insurance_payment'),
    insurance_adjustment: get('insurance_adjustment'),
    invoice_amount: num('invoice_amount'),
    collected_from_patient: get('collected_from_patient'),
    patient_pay_status: get('patient_pay_status'),
    patient_pay_status_color: get('patient_pay_status_color'),
    payment_date: get('payment_date'),
    payment_date_color: get('payment_date_color'),
    ar_type: get('ar_type'),
    ar_amount: num('ar_amount'),
    ar_date: get('ar_date'),
    ar_date_color: get('ar_date_color'),
    ar_notes: get('ar_notes'),
    provider_payment_amount: num('provider_payment_amount'),
    provider_payment_date: get('provider_payment_date'),
    provider_payment_notes: get('provider_payment_notes'),
    highlight_color: get('highlight_color'),
    total: row.total != null ? String(row.total) : null,
  }
}

function rowHasData(row: Record<string, unknown>): boolean {
  const id = String(row.id ?? '')
  if (!id.startsWith('empty-')) return true
  return !!(
    row.patient_id ||
    row.appointment_date ||
    row.cpt_code ||
    row.appointment_status ||
    row.claim_status ||
    row.submit_date ||
    row.insurance_payment ||
    row.payment_date ||
    row.insurance_adjustment ||
    row.collected_from_patient ||
    row.patient_pay_status ||
    row.ar_date ||
    row.total !== null ||
    row.notes
  )
}

serviceRoutes.post('/send-contact', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim()
  const content = String(req.body?.content ?? '').trim()
  const phone = String(req.body?.phone ?? '').trim()
  if (!name || !email || !content) {
    res.status(400).json({ error: 'Missing required fields: name, email, content' })
    return
  }
  const transport = createMailTransport()
  if (!transport) {
    res.status(500).json({ error: 'Server email not configured' })
    return
  }
  const from = env.GMAIL_USER!
  const subject = `Contact form: ${name}`
  const text = [name, email, phone ? `Phone: ${phone}` : '', '', 'Message:', content].filter(Boolean).join('\n')
  const html = [
    `<p><strong>Name:</strong> ${escapeHtml(name)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(email)}</p>`,
    phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : '',
    '<p><strong>Message:</strong></p>',
    `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`,
  ].join('')
  try {
    await transport.sendMail({
      from: `"Contact Form" <${from}>`,
      to: env.CONTACT_TO_EMAIL,
      replyTo: email,
      subject,
      text,
      html,
    })
  } catch {
    res.status(500).json({ error: 'Failed to send message' })
    return
  }
  res.json({ success: true })
})

serviceRoutes.post('/send-invite-email', async (req, res) => {
  const email = String(req.body?.email ?? '').trim()
  const tempPassword = String(req.body?.tempPassword ?? req.body?.temp_password ?? '').trim()
  const appOrigin = String(req.body?.appOrigin ?? '').replace(/\/$/, '')
  if (!email || !tempPassword || !appOrigin) {
    res.status(400).json({ error: 'Missing email, tempPassword, or appOrigin' })
    return
  }
  const transport = createMailTransport()
  if (!transport) {
    res.status(500).json({ error: 'Email not configured' })
    return
  }
  const ins = await pool.query<{ token: string }>(
    `INSERT INTO public.invite_tokens (email, temp_password, expires_at)
     VALUES ($1, $2, now() + interval '24 hours')
     RETURNING token::text AS token`,
    [email, tempPassword],
  )
  const token = ins.rows[0]?.token
  if (!token) {
    res.status(500).json({ error: 'Failed to create invite token' })
    return
  }
  const signInLink = `${appOrigin}/login?email=${encodeURIComponent(email)}&invite=${encodeURIComponent(token)}`
  const from = env.GMAIL_USER!
  try {
    await transport.sendMail({
      from: `"Matrix" <${from}>`,
      to: email,
      subject: 'Your Matrix sign-in link',
      text: `You have been added to Matrix. Sign in using this link (email and password will be pre-filled):\n\n${signInLink}\n\nThis link is valid for 24 hours and can only be used once.`,
      html: `<p>You have been added to Matrix. Click the link below to sign in (your email and password will be pre-filled):</p><p><a href="${signInLink.replace(/"/g, '&quot;')}">Sign in to Matrix</a></p><p>This link is valid for 24 hours and can only be used once.</p>`,
    })
  } catch {
    res.status(500).json({ error: 'Failed to send email' })
    return
  }
  res.json({ success: true })
})

serviceRoutes.get('/get-invite-credentials', async (req, res) => {
  const token = String(req.query.token ?? '').trim()
  if (!token) {
    res.status(400).json({ error: 'Missing token' })
    return
  }
  const sel = await pool.query<{ email: string; temp_password: string }>(
    `SELECT email, temp_password FROM public.invite_tokens
     WHERE token = $1::uuid AND expires_at > now()`,
    [token],
  )
  const row = sel.rows[0]
  if (!row) {
    res.status(404).json({ error: 'Invalid or expired link' })
    return
  }
  await pool.query(`DELETE FROM public.invite_tokens WHERE token = $1::uuid`, [token])
  res.json({ email: row.email, password: row.temp_password })
})

serviceRoutes.post('/save-pending-provider-sheet', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const clinicId = typeof req.body?.clinicId === 'string' ? req.body.clinicId.trim() : ''
  const providerId = typeof req.body?.providerId === 'string' ? req.body.providerId.trim() : ''
  const selectedMonthKey = typeof req.body?.selectedMonthKey === 'string' ? req.body.selectedMonthKey.trim() : ''
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []

  if (!clinicId || !providerId || !selectedMonthKey) {
    res.status(400).json({ error: 'Missing clinicId, providerId, or selectedMonthKey' })
    return
  }

  const parsed = parseMonthKey(selectedMonthKey)
  if (!parsed) {
    res.status(400).json({ error: 'Invalid selectedMonthKey' })
    return
  }

  const access = await pool.query(
    `SELECT 1
     FROM public.provider_sheets ps
     JOIN public.users u ON u.id = $1::uuid
     WHERE ps.clinic_id = $2::uuid
       AND ps.provider_id = $3::uuid
       AND ps.month = $4 AND ps.year = $5 AND ps.payroll = $6
       AND (
         u.role = 'super_admin'
         OR ps.clinic_id = ANY (COALESCE(u.clinic_ids, '{}'::uuid[]))
       )
     LIMIT 1`,
    [callerId, clinicId, providerId, parsed.month, parsed.year, parsed.payroll],
  )
  if (!access.rowCount) {
    res.status(404).json({ error: 'Sheet not found or access denied' })
    return
  }

  const sheetQ = await pool.query<{ id: string }>(
    `SELECT id FROM public.provider_sheets
     WHERE clinic_id = $1::uuid AND provider_id = $2::uuid
       AND month = $3 AND year = $4 AND payroll = $5
     LIMIT 1`,
    [clinicId, providerId, parsed.month, parsed.year, parsed.payroll],
  )
  const sheetId = sheetQ.rows[0]?.id
  if (!sheetId) {
    res.status(404).json({ error: 'Sheet not found for this clinic/provider/month' })
    return
  }

  const rowsToProcess = rows
    .filter((r: unknown) => typeof r === 'object' && r !== null && rowHasData(r as Record<string, unknown>))
    .map((r: unknown) => r as Record<string, unknown>)

  if (rowsToProcess.length === 0) {
    res.json({ success: true, saved: 0 })
    return
  }

  const savedIds: string[] = []
  const cols = [
    'sheet_id',
    'sort_order',
    'patient_id',
    'appointment_date',
    'appointment_time',
    'visit_type',
    'notes',
    'billing_code',
    'billing_code_color',
    'cpt_code',
    'cpt_code_color',
    'appointment_status',
    'appointment_status_color',
    'claim_status',
    'claim_status_color',
    'submit_date',
    'insurance_payment',
    'insurance_adjustment',
    'invoice_amount',
    'collected_from_patient',
    'patient_pay_status',
    'patient_pay_status_color',
    'payment_date',
    'payment_date_color',
    'ar_type',
    'ar_amount',
    'ar_date',
    'ar_date_color',
    'ar_notes',
    'provider_payment_amount',
    'provider_payment_date',
    'provider_payment_notes',
    'highlight_color',
    'total',
  ] as const

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i]
    const id = String(row.id ?? '')
    const payload = rowToDbPayload(row, sheetId, i)
    const values = cols.map((c) => payload[c])

    if (isUuid(id)) {
      const setParts = cols
        .filter((c) => c !== 'sheet_id')
        .map((c, idx) => `"${c}" = $${idx + 1}`)
      const setParams = cols.filter((c) => c !== 'sheet_id').map((c) => payload[c])
      const uq = await pool.query(
        `UPDATE public.provider_sheet_rows SET ${setParts.join(', ')}, "updated_at" = now()
         WHERE id = $${setParams.length + 1}::uuid AND sheet_id = $${setParams.length + 2}::uuid
         RETURNING id`,
        [...setParams, id, sheetId],
      )
      if (uq.rows[0]?.id) savedIds.push(uq.rows[0].id)
      else savedIds.push(id)
    } else {
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ')
      const iq = await pool.query<{ id: string }>(
        `INSERT INTO public.provider_sheet_rows (${cols.map((c) => `"${c}"`).join(', ')})
         VALUES (${placeholders})
         RETURNING id`,
        values,
      )
      if (iq.rows[0]?.id) savedIds.push(iq.rows[0].id)
    }
  }

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM public.provider_sheet_rows WHERE sheet_id = $1::uuid`,
    [sheetId],
  )
  const existingIds = existing.rows.map((r) => r.id)
  const idsToDelete = existingIds.filter((id) => !savedIds.includes(id))
  if (idsToDelete.length > 0) {
    await pool.query(`DELETE FROM public.provider_sheet_rows WHERE id = ANY($1::uuid[])`, [idsToDelete])
  }

  res.json({ success: true, saved: savedIds.length })
})
