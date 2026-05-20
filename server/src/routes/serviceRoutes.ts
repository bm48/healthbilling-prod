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

function createMailTransport(context: string) {
  const user = env.GMAIL_USER
  const pass = env.GMAIL_APP_PASSWORD
  if (!user || !pass) {
    // eslint-disable-next-line no-console
    console.error(`[mail:${context}] createMailTransport: missing credentials`, {
      hasGmailUser: Boolean(user),
      gmailUserLength: user?.length ?? 0,
      hasAppPassword: Boolean(pass),
      appPasswordLength: pass?.length ?? 0,
    })
    return null
  }
  const host = env.SMTP_HOST?.trim() || 'smtp.gmail.com'
  const port = env.SMTP_PORT
  const secure = env.SMTP_SECURE || port === 465
  // eslint-disable-next-line no-console
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  })
}

function nodemailerErrorDetails(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { raw: String(err) }
  const e = err as Error & {
    code?: string
    command?: string
    response?: string
    responseCode?: number
    errno?: number
    syscall?: string
    address?: string
    port?: number
  }
  return {
    name: e.name,
    message: e.message,
    code: e.code,
    command: e.command,
    responseCode: e.responseCode,
    response: e.response,
    errno: e.errno,
    syscall: e.syscall,
    address: e.address,
    port: e.port,
  }
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
  // eslint-disable-next-line no-console
  if (!name || !email || !content) {
    // eslint-disable-next-line no-console
    console.warn('[send-contact] validation failed: missing name, email, or content')
    res.status(400).json({ error: 'Missing required fields: name, email, content' })
    return
  }
  const transport = createMailTransport('send-contact')
  if (!transport) {
    // eslint-disable-next-line no-console
    console.error('[send-contact] abort: no mail transport (set GMAIL_USER + GMAIL_APP_PASSWORD in server/.env)')
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
  // eslint-disable-next-line no-console
  try {
    const info = await transport.sendMail({
      from: `"Contact Form" <${from}>`,
      to: env.CONTACT_TO_EMAIL,
      replyTo: email,
      subject,
      text,
      html,
    })
    // eslint-disable-next-line no-consolerejected: info.rejected })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[send-contact] sendMail failed', nodemailerErrorDetails(err), err)
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
  const transport = createMailTransport('send-invite-email')
  if (!transport) {
    // eslint-disable-next-line no-console
    console.error('[send-invite-email] abort: no mail transport')
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

  // Near-real-time: recompute invoice summary for this clinic/month/year after saving rows.
  recomputeClinicInvoice(clinicId, parsed.month, parsed.year).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[invoice] recompute failed after sheet save:', err)
  })

  res.json({ success: true, saved: savedIds.length })
})

// ---------------------------------------------------------------------------
// Invoice recompute helpers
// ---------------------------------------------------------------------------

function parseNumericCell(v: unknown): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Recomputes and upserts the `invoices` row for a given clinic+month+year.
 * Computed fields are always overwritten; payment_status/payment_date/due_date are preserved on conflict.
 */
async function recomputeClinicInvoice(clinicId: string, month: number, year: number): Promise<void> {
  // 1. Clinic invoice_rate
  const clinicQ = await pool.query<{ invoice_rate: string | null }>(
    `SELECT invoice_rate FROM public.clinics WHERE id = $1::uuid LIMIT 1`,
    [clinicId],
  )
  const invoiceRate = clinicQ.rows[0]?.invoice_rate != null
    ? parseFloat(String(clinicQ.rows[0].invoice_rate))
    : 0

  // 2. All provider sheets for this clinic/month/year (all payroll periods)
  const sheetsQ = await pool.query<{ id: string }>(
    `SELECT id FROM public.provider_sheets WHERE clinic_id = $1::uuid AND month = $2 AND year = $3`,
    [clinicId, month, year],
  )
  const sheetIds = sheetsQ.rows.map((r) => r.id)

  let insuranceTotal = 0
  let patientTotal = 0
  let arTotal = 0

  if (sheetIds.length > 0) {
    const rowsQ = await pool.query<{
      insurance_payment: string | null
      collected_from_patient: string | null
      ar_amount: string | null
    }>(
      `SELECT insurance_payment, collected_from_patient, ar_amount
       FROM public.provider_sheet_rows
       WHERE sheet_id = ANY($1::uuid[])`,
      [sheetIds],
    )
    for (const r of rowsQ.rows) {
      insuranceTotal += parseNumericCell(r.insurance_payment)
      patientTotal += parseNumericCell(r.collected_from_patient)
      arTotal += parseNumericCell(r.ar_amount)
    }
  }

  // 3. clinic_invoice_notes for additional_fee and note
  const notesQ = await pool.query<{ additional_fee: string | null; note: string | null }>(
    `SELECT additional_fee, note FROM public.clinic_invoice_notes
     WHERE clinic_id = $1::uuid AND month = $2 AND year = $3 LIMIT 1`,
    [clinicId, month, year],
  )
  const additionalFee = notesQ.rows[0]?.additional_fee != null
    ? parseFloat(String(notesQ.rows[0].additional_fee))
    : 0
  const note = notesQ.rows[0]?.note ?? null

  // 4. Compute totals
  const subtotal = insuranceTotal + patientTotal + arTotal + additionalFee
  const invoiceTotal = subtotal * (Number.isFinite(invoiceRate) ? invoiceRate : 0)

  // 5. Default due_date = 15th of the following month
  const dueYear = month === 12 ? year + 1 : year
  const dueMonth = month === 12 ? 1 : month + 1
  const defaultDueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-15`

  // 6. Upsert: INSERT preserves due_date default; UPDATE preserves editable fields
  await pool.query(
    `INSERT INTO public.invoices (
       clinic_id, month, year,
       insurance_payment_total, patient_payment_total, accounts_receivable_total,
       additional_fee, subtotal, invoice_rate, invoice_total,
       note, due_date, computed_at, created_at, updated_at
     ) VALUES (
       $1::uuid, $2, $3,
       $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12::date, now(), now(), now()
     )
     ON CONFLICT (clinic_id, month, year) DO UPDATE SET
       insurance_payment_total = EXCLUDED.insurance_payment_total,
       patient_payment_total   = EXCLUDED.patient_payment_total,
       accounts_receivable_total = EXCLUDED.accounts_receivable_total,
       additional_fee          = EXCLUDED.additional_fee,
       subtotal                = EXCLUDED.subtotal,
       invoice_rate            = EXCLUDED.invoice_rate,
       invoice_total           = EXCLUDED.invoice_total,
       note                    = EXCLUDED.note,
       computed_at             = now(),
       updated_at              = now()`,
    [
      clinicId, month, year,
      insuranceTotal.toFixed(2),
      patientTotal.toFixed(2),
      arTotal.toFixed(2),
      additionalFee.toFixed(2),
      subtotal.toFixed(2),
      Number.isFinite(invoiceRate) ? invoiceRate : null,
      invoiceTotal.toFixed(2),
      note,
      defaultDueDate,
    ],
  )
}

/** POST /api/upsert-clinic-invoice  { clinicId, month, year } */
serviceRoutes.post('/upsert-clinic-invoice', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const clinicId = typeof req.body?.clinicId === 'string' ? req.body.clinicId.trim() : ''
  const month = Number(req.body?.month)
  const year = Number(req.body?.year)
  if (!clinicId || !Number.isFinite(month) || !Number.isFinite(year)) {
    res.status(400).json({ error: 'Missing or invalid clinicId, month, year' })
    return
  }
  try {
    await recomputeClinicInvoice(clinicId, month, year)
    res.json({ success: true })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[invoice] upsert-clinic-invoice failed:', err)
    res.status(500).json({ error: 'Failed to recompute invoice' })
  }
})

/** POST /api/recompute-invoices-for-month  { month, year }
 * Recomputes invoices for ALL clinics for the given month/year (super admin use).
 */
serviceRoutes.post('/recompute-invoices-for-month', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const month = Number(req.body?.month)
  const year = Number(req.body?.year)
  if (!Number.isFinite(month) || !Number.isFinite(year)) {
    res.status(400).json({ error: 'Missing or invalid month or year' })
    return
  }
  try {
    const clinicsQ = await pool.query<{ id: string }>(`SELECT id FROM public.clinics`)
    const results = await Promise.allSettled(
      clinicsQ.rows.map((c) => recomputeClinicInvoice(c.id, month, year)),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    res.json({ success: true, total: clinicsQ.rows.length, failed })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[invoice] recompute-invoices-for-month failed:', err)
    res.status(500).json({ error: 'Failed to recompute invoices' })
  }
})
