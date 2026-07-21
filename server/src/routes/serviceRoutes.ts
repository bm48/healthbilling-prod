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

const PROVIDER_SHEET_ROW_COLS = [
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

type SaveProviderSheetResult = {
  saved: number
  rows: Record<string, unknown>[]
  invoiceRecomputed: boolean
}

/** Saves provider sheet rows and awaits invoice recompute for the clinic/month/year. */
async function saveProviderSheetRowsCore(
  callerId: string,
  clinicId: string,
  providerId: string,
  selectedMonthKey: string,
  rows: unknown[],
  knownDeletedIds?: string[],
): Promise<SaveProviderSheetResult> {
  const parsed = parseMonthKey(selectedMonthKey)
  if (!parsed) {
    throw new Error('Invalid selectedMonthKey')
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
    throw new Error('Sheet not found or access denied')
  }

  // ORDER BY id ASC to match the client's sheet resolution (fetchProviderSheetData does the same
  // — see ClinicDetail.tsx:1953). When duplicate provider_sheets rows exist for the same
  // (clinic, provider, month, year, payroll) tuple — a state the codebase already tolerates
  // silently — the plain LIMIT 1 without ORDER BY returned whichever row Postgres' heap-scan
  // happened to yield first. That could differ from what the client fetched: reads went to sheet
  // A, writes went to sheet B. Users saw edits stick during a session (cached optimistic state)
  // but a hard refresh re-fetched from sheet A which had no writes → blank sheet. That's the
  // "refresh keeps blanking Spencer's June/July" report from Jenali. Aligning the ORDER BY makes
  // reads and writes hit the same row, so at worst the "loser" duplicate sheet becomes an
  // orphan that never gets touched again (recoverable), never a data-loss cliff.
  const sheetQ = await pool.query<{ id: string }>(
    `SELECT id FROM public.provider_sheets
     WHERE clinic_id = $1::uuid AND provider_id = $2::uuid
       AND month = $3 AND year = $4 AND payroll = $5
     ORDER BY id ASC
     LIMIT 1`,
    [clinicId, providerId, parsed.month, parsed.year, parsed.payroll],
  )
  const sheetId = sheetQ.rows[0]?.id
  if (!sheetId) {
    throw new Error('Sheet not found for this clinic/provider/month')
  }

  const rowsToProcess = rows
    .filter((r: unknown) => typeof r === 'object' && r !== null && rowHasData(r as Record<string, unknown>))
    .map((r: unknown) => r as Record<string, unknown>)

  const cols = PROVIDER_SHEET_ROW_COLS
  const savedIds: string[] = []
  const savedRows: Record<string, unknown>[] = []

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i]
    const id = String(row.id ?? '')
    const payload = rowToDbPayload(row, sheetId, i)
    const values = cols.map((c) => payload[c])

    if (isUuid(id)) {
      // Write guard for workflow-critical columns. Any save that arrives with `null` for these — including
      // a stale-snapshot save from a silent client-side failure path — is treated as "no change" instead
      // of "clear to null". With COALESCE($N, "col"), a null payload keeps whatever the DB already has
      // and only a non-null payload overwrites. The trade-off is that these columns cannot be CLEARED
      // via UPDATE; clearing must be done by deleting the whole row. That matches how a user would
      // actually undo one of these values in workflow terms — a cancelled appointment / voided claim
      // gets its row removed, not each field wiped individually.
      //
      // The protected set covers every field that (a) represents typed-in workflow state we've already
      // seen stale-snapshot loss on, or (b) is a money / date / notes field where clearing to null in
      // isolation is uncommon enough to prefer safety. Fields deliberately LEFT UNPROTECTED are ones a
      // user legitimately toggles between value and null in normal editing (patient_id assign/unassign;
      // cpt_code / billing_code corrections; status categories; visit_type; appointment_time; the
      // `_color` fields derived from paired non-color values; user-preference `highlight_color`;
      // `invoice_amount` which is computed; `sort_order` which is structural).
      //
      // If a specific column here turns out to have a legitimate clear workflow we didn't anticipate,
      // the escape hatch is an explicit `clearColumns: ['<col>', ...]` opt-out on the request payload
      // that this loop can consult before applying COALESCE. Don't add that speculatively — wait for
      // the concrete complaint.
      const PROTECTED_FROM_NULL = new Set([
        // Original three — the columns Jenali repeatedly lost data on and the reason this guard exists.
        'appointment_date',
        'claim_status',
        'submit_date',
        // Money fields — corrected via overwrite, not null; if the row shouldn't exist at all, deleted.
        'insurance_payment',
        'insurance_adjustment',
        'collected_from_patient',
        'ar_amount',
        'provider_payment_amount',
        'total',
        // Dates on entered transactions — rescheduled dates get overwritten, not nulled.
        'payment_date',
        'ar_date',
        'provider_payment_date',
        // AR classification — once assigned to a row, changed via overwrite, not null.
        'ar_type',
        // Notes fields — typed-in free text that has repeatedly been the visible surface of data loss.
        // Users edit notes by overwriting text (non-null payload → normal write); an explicit clear-
        // to-null happens rarely enough that we prefer protection.
        'notes',
        'ar_notes',
        'provider_payment_notes',
      ])
      const setParts = cols
        .filter((c) => c !== 'sheet_id')
        .map((c, idx) =>
          PROTECTED_FROM_NULL.has(c)
            ? `"${c}" = COALESCE($${idx + 1}, "${c}")`
            : `"${c}" = $${idx + 1}`,
        )
      const setParams = cols.filter((c) => c !== 'sheet_id').map((c) => payload[c])
      const uq = await pool.query<Record<string, unknown>>(
        `UPDATE public.provider_sheet_rows SET ${setParts.join(', ')}, "updated_at" = now()
         WHERE id = $${setParams.length + 1}::uuid AND sheet_id = $${setParams.length + 2}::uuid
         RETURNING *`,
        [...setParams, id, sheetId],
      )
      if (uq.rows[0]) {
        savedIds.push(String(uq.rows[0].id))
        savedRows.push(uq.rows[0])
      } else {
        savedIds.push(id)
      }
    } else {
      // Date-only stray guard: reject INSERTs whose ONLY content is `appointment_date`. Those rows
      // are stale-state artifacts from the pagehide/debounce race (same race behind the identity
      // dedupe below) — the row was captured mid-edit after the user typed a date but before they
      // typed a patient_id. They surface in the sheet as rows with nothing but a date filled in
      // (rows 113/114/116/117/119-122 in the Morgan Huls July 2026 screenshot). A billing row
      // without a patient / CPT / status / money field / notes isn't a real entry — nothing in
      // this app makes decisions based on a date alone. Dropping them silently avoids polluting
      // the sheet with stray dated rows the user never intended to create. Identity-dedupe below
      // handles the "date + patient_id" duplicates; this guard handles the "date only" cousins.
      const isDateOnlyStray =
        payload.appointment_date != null && payload.appointment_date !== '' &&
        !payload.patient_id &&
        !payload.cpt_code &&
        !payload.appointment_status &&
        !payload.claim_status &&
        !payload.submit_date &&
        !payload.insurance_payment &&
        !payload.insurance_adjustment &&
        (payload.invoice_amount == null || payload.invoice_amount === '') &&
        !payload.collected_from_patient &&
        !payload.patient_pay_status &&
        !payload.payment_date &&
        !payload.ar_date &&
        (payload.ar_amount == null || payload.ar_amount === '') &&
        !payload.ar_type &&
        !payload.notes &&
        !payload.ar_notes
      if (isDateOnlyStray) {
        // eslint-disable-next-line no-console
        console.warn('[provider_sheet_rows] skipped date-only stray INSERT', {
          sheetId,
          incomingTempId: id,
          appointmentDate: payload.appointment_date,
          callerId,
          clinicId,
          providerId,
          selectedMonthKey,
        })
        continue
      }
      // Server-side idempotency dedupe (mitigation for the client-side pagehide/debounce race —
      // see ClinicDetail.tsx onPageHide + ProvidersTab's per-edit localStorage write around
      // line 2519-2537). When the user types, ProvidersTab writes the current in-memory rows to
      // localStorage (with `new-*` temp ids), then the 400ms debounced save fires. If the tab
      // becomes hidden mid-window, ClinicDetail's onPageHide POSTs the localStorage rows via
      // keepalive fetch — server INSERTs them. When the tab returns, the pending debounce also
      // fires with the SAME `new-*` ids (the ref never learned about the pagehide POST because it
      // was fire-and-forget with no response). Server INSERTs them again → duplicate row for the
      // same edit. Multiply by every tab-switch during a workday and you get Jenali's Morgan/
      // Spencer/Keana pattern (same patient row repeated 5-7 times, sometimes with mixed states).
      //
      // Rule: if an incoming INSERT carries a real identity (patient_id AND appointment_date both
      // non-null) that matches an existing row on this sheet, treat it as an UPDATE of the
      // existing row instead of creating a new one. Use COALESCE on EVERY column (not just the
      // usual PROTECTED_FROM_NULL set) so a stale payload with fewer fields can never null out
      // data that arrived from another (concurrent or earlier) save. Net effect: identical
      // duplicates collapse into a single row; enriching data merges into the existing row;
      // legitimately distinct rows (different date, different patient, or a truly new visit) go
      // through the normal INSERT path.
      //
      // Match key is (sheet_id, patient_id, appointment_date). We intentionally do NOT include
      // cpt_code / appointment_status in the match because the race often catches a row before
      // those fields are typed, so the duplicate INSERT would carry NULL cpt while the earlier
      // one has the real CPT — requiring exact cpt match would leave the duplicate. Two visits
      // for the same patient on the same date but with different times/CPTs would still collapse
      // here — if that's a real workflow, we'll add a discriminator (appointment_time in the key,
      // or an explicit "force-insert" flag on the payload) once we see it complained about.
      //
      // `IS NOT DISTINCT FROM` on appointment_date (instead of `=`) so NULL matches NULL. Without
      // that, two INSERTs both carrying (patient_id, appointment_date=NULL) would slip through
      // because `NULL = NULL` is false in SQL. That was the "patient set, date not yet typed"
      // gap Bert flagged after the first server-side dedupe rolled out — the identity dedupe
      // caught (P, D) + (P, D) duplicates but not (P, NULL) + (P, NULL) duplicates from the same
      // race. The outer guard now only requires `patient_id`, not date, so the SELECT runs for
      // both cases. Rows without patient_id go straight to INSERT (no meaningful identity to
      // dedupe on); those either carry other data (fine to have multiple) or are date-only
      // strays already dropped by the guard above.
      const incomingPatientId = payload.patient_id
      const incomingApptDate = payload.appointment_date ?? null
      let idempotentUpdateApplied = false
      if (incomingPatientId != null && incomingPatientId !== '') {
        const dupCheck = await pool.query<{ id: string }>(
          `SELECT id FROM public.provider_sheet_rows
           WHERE sheet_id = $1::uuid
             AND patient_id = $2
             AND appointment_date IS NOT DISTINCT FROM $3
           ORDER BY created_at ASC
           LIMIT 1`,
          [sheetId, incomingPatientId, incomingApptDate],
        )
        if (dupCheck.rowCount && dupCheck.rows[0]) {
          const existingId = dupCheck.rows[0].id
          // COALESCE on every column: incoming NULL never overwrites existing data. Incoming non-
          // null does overwrite (so enrichment — adding CPT to a row that only had patient/date —
          // still works). This mirrors PROTECTED_FROM_NULL's semantics but applied universally.
          const dedupCols = cols.filter((c) => c !== 'sheet_id')
          const dedupSetParts = dedupCols.map(
            (c, idx) => `"${c}" = COALESCE($${idx + 1}, "${c}")`,
          )
          const dedupSetParams = dedupCols.map((c) => payload[c])
          const uq = await pool.query<Record<string, unknown>>(
            `UPDATE public.provider_sheet_rows
             SET ${dedupSetParts.join(', ')}, "updated_at" = now()
             WHERE id = $${dedupSetParams.length + 1}::uuid AND sheet_id = $${dedupSetParams.length + 2}::uuid
             RETURNING *`,
            [...dedupSetParams, existingId, sheetId],
          )
          if (uq.rows[0]) {
            savedIds.push(String(uq.rows[0].id))
            savedRows.push(uq.rows[0])
            idempotentUpdateApplied = true
            // eslint-disable-next-line no-console
            console.warn('[provider_sheet_rows] collapsed duplicate INSERT into existing row', {
              sheetId,
              incomingTempId: id,
              collapsedIntoRowId: existingId,
              patientId: incomingPatientId,
              appointmentDate: incomingApptDate,
              callerId,
              clinicId,
              providerId,
              selectedMonthKey,
            })
          }
        }
      }
      if (!idempotentUpdateApplied) {
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ')
        const iq = await pool.query<Record<string, unknown>>(
          `INSERT INTO public.provider_sheet_rows (${cols.map((c) => `"${c}"`).join(', ')})
           VALUES (${placeholders})
           RETURNING *`,
          values,
        )
        if (iq.rows[0]) {
          savedIds.push(String(iq.rows[0].id))
          savedRows.push(iq.rows[0])
        }
      }
    }
  }

  // Deletes ONLY when caller explicitly enumerates them. The old "orphan sweep" (SELECT all rows for
  // sheet, DELETE anything not in this batch) silently destroyed months of data when a stale or partial
  // batch was POSTed (e.g., from pagehide replay or a save fired before initial hydration). Never sweep
  // implicitly again — orphan rows are recoverable; deleted user input is not.
  if (knownDeletedIds !== undefined) {
    // Safeguard: never DELETE a UUID that was just UPDATE-ed / INSERT-ed in the same batch. The loop
    // above already wrote those rows; wiping them here would be equivalent to a no-op save at best
    // and total data loss at worst. This bit us on the auto-backup restore path: auto-backups carry
    // rows with their original UUIDs (see the tab-leave INSERT above), so a caller that passes
    // "delete every current UUID" alongside a batch that also carries those UUIDs (a plausible
    // implementation of "wipe stale rows, apply backup") ends up UPDATE-ing then DELETE-ing every
    // row — the sheet goes blank. Filter the intersection out before the DELETE.
    const savedIdSet = new Set(savedIds.map(String))
    const toDelete = knownDeletedIds
      .filter((id) => isUuid(String(id)))
      .filter((id) => !savedIdSet.has(String(id)))
    if (toDelete.length > 0) {
      await pool.query(
        `DELETE FROM public.provider_sheet_rows WHERE id = ANY($1::uuid[]) AND sheet_id = $2::uuid`,
        [toDelete, sheetId],
      )
    }
  }

  await recomputeClinicInvoice(clinicId, parsed.month, parsed.year)

  return {
    saved: savedIds.length,
    rows: savedRows,
    invoiceRecomputed: true,
  }
}

async function handleSaveProviderSheetRows(req: import('express').Request, res: import('express').Response) {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const clinicId = typeof req.body?.clinicId === 'string' ? req.body.clinicId.trim() : ''
  const providerId = typeof req.body?.providerId === 'string' ? req.body.providerId.trim() : ''
  const selectedMonthKey = typeof req.body?.selectedMonthKey === 'string' ? req.body.selectedMonthKey.trim() : ''
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
  const knownDeletedIds = Array.isArray(req.body?.knownDeletedIds)
    ? req.body.knownDeletedIds.map((id: unknown) => String(id)).filter((id: string) => isUuid(id))
    : undefined

  if (!clinicId || !providerId || !selectedMonthKey) {
    res.status(400).json({ error: 'Missing clinicId, providerId, or selectedMonthKey' })
    return
  }

  try {
    const result = await saveProviderSheetRowsCore(
      callerId,
      clinicId,
      providerId,
      selectedMonthKey,
      rows,
      knownDeletedIds,
    )
    res.json({ success: true, saved: result.saved, rows: result.rows, invoiceRecomputed: result.invoiceRecomputed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Save failed'
    const status = msg.includes('not found') || msg.includes('denied') ? 404 : msg.includes('Invalid') ? 400 : 500
    if (status === 500) {
      // eslint-disable-next-line no-console
      console.error('[provider-sheet] save failed:', err)
    }
    res.status(status).json({ error: msg })
  }
}

serviceRoutes.post('/save-provider-sheet-rows', handleSaveProviderSheetRows)
/** @deprecated Use /save-provider-sheet-rows — kept for page-unload keepalive callers */
serviceRoutes.post('/save-pending-provider-sheet', handleSaveProviderSheetRows)

// ---------------------------------------------------------------------------
// Auto-backups: tab-leave snapshots of a provider sheet.
// Distinct from /save-provider-sheet-rows (which writes the live row state) and from the
// cron-based /api/cron/backup-provider-sheets (which exports CSV files to storage). These
// endpoints write/read raw JSON snapshots in `provider_sheet_tab_leave_backups`, retained
// for 7 days and lazy-pruned on insert.
// ---------------------------------------------------------------------------

/** Shared access check: user must have access to the clinic that owns this sheet. */
async function assertSheetAccess(callerId: string, sheetId: string): Promise<void> {
  const access = await pool.query(
    `SELECT 1
     FROM public.provider_sheets ps
     JOIN public.users u ON u.id = $1::uuid
     WHERE ps.id = $2::uuid
       AND (
         u.role = 'super_admin'
         OR ps.clinic_id = ANY (COALESCE(u.clinic_ids, '{}'::uuid[]))
       )
     LIMIT 1`,
    [callerId, sheetId],
  )
  if (!access.rowCount) throw new Error('Sheet not found or access denied')
}

const TAB_LEAVE_BACKUP_RETENTION_DAYS = 7

/** POST /api/auto-backup-provider-sheet — body: { sheetId, rows } */
serviceRoutes.post('/auto-backup-provider-sheet', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const sheetId = typeof req.body?.sheetId === 'string' ? req.body.sheetId.trim() : ''
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null
  if (!sheetId || rows == null) {
    res.status(400).json({ error: 'Missing sheetId or rows' })
    return
  }
  if (!isUuid(sheetId)) {
    res.status(400).json({ error: 'Invalid sheetId' })
    return
  }
  try {
    await assertSheetAccess(callerId, sheetId)
    const insert = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO public.provider_sheet_tab_leave_backups (sheet_id, user_id, rows)
       VALUES ($1::uuid, $2::uuid, $3::jsonb)
       RETURNING id, created_at`,
      [sheetId, callerId, JSON.stringify(rows)],
    )
    // Lazy retention: prune entries older than the retention window for THIS sheet only. Keeping
    // the prune scoped means a sheet that hasn't been touched in a year doesn't get its backups
    // wiped just because some other sheet got a fresh write.
    await pool.query(
      `DELETE FROM public.provider_sheet_tab_leave_backups
       WHERE sheet_id = $1::uuid
         AND created_at < now() - ($2 || ' days')::interval`,
      [sheetId, String(TAB_LEAVE_BACKUP_RETENTION_DAYS)],
    )
    const row = insert.rows[0]
    res.json({ id: row.id, created_at: row.created_at })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Backup failed'
    const status = msg.includes('denied') || msg.includes('not found') ? 404 : 500
    if (status === 500) {
      // eslint-disable-next-line no-console
      console.error('[auto-backup] insert failed:', err)
    }
    res.status(status).json({ error: msg })
  }
})

/** GET /api/auto-backup-provider-sheet?sheetId=X — list backups (metadata only, newest first) */
serviceRoutes.get('/auto-backup-provider-sheet', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const sheetId = typeof req.query?.sheetId === 'string' ? req.query.sheetId.trim() : ''
  if (!sheetId || !isUuid(sheetId)) {
    res.status(400).json({ error: 'Missing or invalid sheetId' })
    return
  }
  try {
    await assertSheetAccess(callerId, sheetId)
    const list = await pool.query<{ id: string; created_at: string; user_id: string | null; user_email: string | null }>(
      `SELECT b.id, b.created_at, b.user_id, u.email AS user_email
       FROM public.provider_sheet_tab_leave_backups b
       LEFT JOIN public.users u ON u.id = b.user_id
       WHERE b.sheet_id = $1::uuid
       ORDER BY b.created_at DESC
       LIMIT 200`,
      [sheetId],
    )
    res.json({ versions: list.rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'List failed'
    const status = msg.includes('denied') || msg.includes('not found') ? 404 : 500
    res.status(status).json({ error: msg })
  }
})

/** GET /api/auto-backup-provider-sheet/:id — fetch full backup (with rows) for restore. */
serviceRoutes.get('/auto-backup-provider-sheet/:id', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const backupId = typeof req.params?.id === 'string' ? req.params.id.trim() : ''
  if (!backupId || !isUuid(backupId)) {
    res.status(400).json({ error: 'Invalid backup id' })
    return
  }
  try {
    const found = await pool.query<{ id: string; sheet_id: string; created_at: string; rows: unknown }>(
      `SELECT id, sheet_id, created_at, rows
       FROM public.provider_sheet_tab_leave_backups
       WHERE id = $1::uuid
       LIMIT 1`,
      [backupId],
    )
    const row = found.rows[0]
    if (!row) {
      res.status(404).json({ error: 'Backup not found' })
      return
    }
    await assertSheetAccess(callerId, row.sheet_id)
    res.json({ id: row.id, sheet_id: row.sheet_id, created_at: row.created_at, rows: row.rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Fetch failed'
    const status = msg.includes('denied') || msg.includes('not found') ? 404 : 500
    res.status(status).json({ error: msg })
  }
})

// ---------------------------------------------------------------------------
// Invoice recompute helpers
// ---------------------------------------------------------------------------

function parseNumericCell(v: unknown): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Provider Pay row indices (matches Provider Pay tab / paystub PDF). */
const PP_ROW_PATIENT = 1
const PP_ROW_INSURANCE = 2
const PP_ROW_AR = 3

/**
 * Recomputes and upserts the `invoices` row for a given clinic+month+year.
 * Primary source: sum of all `provider_pay_rows` (all providers, all payroll periods).
 * Fallback: `provider_sheet_rows` for providers with no `provider_pay` header that month.
 * Computed fields are always overwritten; payment_date and due_date are preserved on conflict.
 *
 * Per-provider mode: when `clinics.invoice_per_provider = true`, the same source data is
 * aggregated PER provider, each provider's subtotal is multiplied by its own rate (provider's
 * own `invoice_rate` override, falling back to the clinic's), and those per-provider amounts are
 * persisted to `invoice_provider_lines`. The top-level `invoices.invoice_total` is the sum of
 * those provider lines plus the additional_fee billed at the clinic-default rate.
 */
async function recomputeClinicInvoice(clinicId: string, month: number, year: number): Promise<void> {
  // 1. Clinic invoice_rate + per-provider mode flag
  const clinicQ = await pool.query<{ invoice_rate: string | null; invoice_per_provider: boolean | null }>(
    `SELECT invoice_rate, invoice_per_provider FROM public.clinics WHERE id = $1::uuid LIMIT 1`,
    [clinicId],
  )
  const invoiceRate = clinicQ.rows[0]?.invoice_rate != null
    ? parseFloat(String(clinicQ.rows[0].invoice_rate))
    : 0
  const perProviderMode = Boolean(clinicQ.rows[0]?.invoice_per_provider)

  // Per-provider running totals: provider_id -> { patient, insurance, ar }. We always populate
  // these (even when perProviderMode is off) so the existing clinic-wide totals are derived from
  // the same source rows. The branch only kicks in when persisting + when applying rates.
  const perProvider = new Map<string, { ins: number; pt: number; ar: number }>()
  const bumpProvider = (providerId: string | null, bucket: 'ins' | 'pt' | 'ar', amt: number) => {
    if (!providerId) return
    const cur = perProvider.get(providerId) ?? { ins: 0, pt: 0, ar: 0 }
    cur[bucket] += amt
    perProvider.set(providerId, cur)
  }

  let insuranceTotal = 0
  let patientTotal = 0
  let arTotal = 0

  // 2. Provider Pay (primary): aggregate rows 1=Patient, 2=Insurance, 3=A/R across every payroll period
  const payRowsQ = await pool.query<{ provider_id: string; row_index: number; amount: string | null }>(
    `SELECT pp.provider_id, ppr.row_index, ppr.amount
     FROM public.provider_pay pp
     INNER JOIN public.provider_pay_rows ppr ON ppr.provider_pay_id = pp.id
     WHERE pp.clinic_id = $1::uuid AND pp.month = $2 AND pp.year = $3
       AND ppr.row_index IN ($4, $5, $6)`,
    [clinicId, month, year, PP_ROW_PATIENT, PP_ROW_INSURANCE, PP_ROW_AR],
  )
  for (const r of payRowsQ.rows) {
    const amt = parseNumericCell(r.amount)
    if (r.row_index === PP_ROW_PATIENT) { patientTotal += amt; bumpProvider(r.provider_id, 'pt', amt) }
    else if (r.row_index === PP_ROW_INSURANCE) { insuranceTotal += amt; bumpProvider(r.provider_id, 'ins', amt) }
    else if (r.row_index === PP_ROW_AR) { arTotal += amt; bumpProvider(r.provider_id, 'ar', amt) }
  }

  // 3. Provider sheets (fallback): providers with no provider_pay record for this clinic/month/year
  const sheetRowsQ = await pool.query<{
    provider_id: string
    insurance_payment: string | null
    collected_from_patient: string | null
    ar_amount: string | null
  }>(
    `SELECT ps.provider_id, psr.insurance_payment, psr.collected_from_patient, psr.ar_amount
     FROM public.provider_sheet_rows psr
     INNER JOIN public.provider_sheets ps ON ps.id = psr.sheet_id
     WHERE ps.clinic_id = $1::uuid AND ps.month = $2 AND ps.year = $3
       AND ps.provider_id NOT IN (
         SELECT DISTINCT pp.provider_id
         FROM public.provider_pay pp
         WHERE pp.clinic_id = $1::uuid AND pp.month = $2 AND pp.year = $3
       )`,
    [clinicId, month, year],
  )
  for (const r of sheetRowsQ.rows) {
    const ins = parseNumericCell(r.insurance_payment)
    const pt = parseNumericCell(r.collected_from_patient)
    const ar = parseNumericCell(r.ar_amount)
    insuranceTotal += ins
    patientTotal += pt
    arTotal += ar
    bumpProvider(r.provider_id, 'ins', ins)
    bumpProvider(r.provider_id, 'pt', pt)
    bumpProvider(r.provider_id, 'ar', ar)
  }

  // 4. clinic_invoice_notes for the free-form memo (the `additional_fee` column is legacy and
  //    zeroed by the multi-line migration; we sum the new lines table below instead).
  const notesQ = await pool.query<{ note: string | null }>(
    `SELECT note FROM public.clinic_invoice_notes
     WHERE clinic_id = $1::uuid AND month = $2 AND year = $3 LIMIT 1`,
    [clinicId, month, year],
  )
  const note = notesQ.rows[0]?.note ?? null

  // Additional-fee lines (multi-row). Sum amount across all rows for this clinic + period. Each
  // line is billed at face value on the invoice — they're never multiplied by the billing rate.
  const additionalLinesQ = await pool.query<{ amount: string | null }>(
    `SELECT amount FROM public.invoice_additional_fee_lines
     WHERE clinic_id = $1::uuid AND month = $2 AND year = $3`,
    [clinicId, month, year],
  )
  let additionalFee = 0
  for (const r of additionalLinesQ.rows) {
    const amt = r.amount != null ? parseFloat(String(r.amount)) : 0
    if (Number.isFinite(amt)) additionalFee += amt
  }

  // 5. Compute totals. Two paths:
  //    a) Clinic-wide mode (default): subtotal × the clinic's invoice_rate, then the additional_fee
  //       is added back at face value (not multiplied by the rate).
  //    b) Per-provider mode: each provider's collected total × that provider's effective rate
  //       (override or clinic default), summed up, then additional_fee at face value.
  //
  //    Subtotal here is just (insurance + patient + ar) — the *collected* amounts. additional_fee
  //    used to be folded into subtotal then run through the rate, which double-billed the fee. It
  //    now lives entirely on its own line on the invoice PDF / Invoices page.
  const subtotal = insuranceTotal + patientTotal + arTotal
  const clinicRateNum = Number.isFinite(invoiceRate) ? invoiceRate : 0
  let invoiceTotal = 0
  // Per-provider line breakdown used below when perProviderMode is true.
  const providerLines: Array<{
    providerId: string
    ins: number
    pt: number
    ar: number
    sub: number
    rate: number
    total: number
  }> = []

  if (perProviderMode) {
    // Pull per-provider rate overrides for every provider that appeared above.
    const providerIds = Array.from(perProvider.keys())
    const ratesByProvider = new Map<string, number>()
    if (providerIds.length > 0) {
      const ratesQ = await pool.query<{ id: string; invoice_rate: string | null }>(
        `SELECT id::text AS id, invoice_rate FROM public.providers WHERE id = ANY($1::uuid[])`,
        [providerIds],
      )
      for (const r of ratesQ.rows) {
        if (r.invoice_rate != null) {
          const n = parseFloat(String(r.invoice_rate))
          if (Number.isFinite(n)) ratesByProvider.set(r.id, n)
        }
      }
    }
    for (const [providerId, tot] of perProvider.entries()) {
      const sub = tot.ins + tot.pt + tot.ar
      const rate = ratesByProvider.get(providerId) ?? clinicRateNum
      const total = sub * rate
      providerLines.push({ providerId, ins: tot.ins, pt: tot.pt, ar: tot.ar, sub, rate, total })
      invoiceTotal += total
    }
    // Additional fee shows as its own line on the invoice — added at face value (not multiplied
    // by any rate, since per Jenali it's a flat charge).
    invoiceTotal += additionalFee
  } else {
    invoiceTotal = subtotal * clinicRateNum + additionalFee
  }

  // 6. Default due_date = 15th of the following month
  const dueYear = month === 12 ? year + 1 : year
  const dueMonth = month === 12 ? 1 : month + 1
  const defaultDueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-15`

  // 7. Upsert: INSERT preserves due_date default; UPDATE preserves editable fields. Returns the
  //    invoice id so we can sync the per-provider line table next.
  const invoiceUpsertQ = await pool.query<{ id: string }>(
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
       updated_at              = now()
     RETURNING id::text AS id`,
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
  const invoiceId = invoiceUpsertQ.rows[0]?.id ?? null

  // 8. Sync per-provider lines. When per-provider mode is on, upsert every provider line and
  //    delete any stale ones from a prior run. When off, blow them all away so the table stays in
  //    sync with whatever the clinic currently wants. (We never leave a half-stale breakdown.)
  if (invoiceId) {
    if (perProviderMode && providerLines.length > 0) {
      for (const line of providerLines) {
        await pool.query(
          `INSERT INTO public.invoice_provider_lines (
             invoice_id, provider_id,
             insurance_payment_total, patient_payment_total, accounts_receivable_total,
             subtotal, invoice_rate, invoice_total, created_at, updated_at
           ) VALUES (
             $1::uuid, $2::uuid,
             $3, $4, $5,
             $6, $7, $8, now(), now()
           )
           ON CONFLICT (invoice_id, provider_id) DO UPDATE SET
             insurance_payment_total   = EXCLUDED.insurance_payment_total,
             patient_payment_total     = EXCLUDED.patient_payment_total,
             accounts_receivable_total = EXCLUDED.accounts_receivable_total,
             subtotal                  = EXCLUDED.subtotal,
             invoice_rate              = EXCLUDED.invoice_rate,
             invoice_total             = EXCLUDED.invoice_total,
             updated_at                = now()`,
          [
            invoiceId, line.providerId,
            line.ins.toFixed(2), line.pt.toFixed(2), line.ar.toFixed(2),
            line.sub.toFixed(2), line.rate, line.total.toFixed(2),
          ],
        )
      }
      const keepIds = providerLines.map((l) => l.providerId)
      await pool.query(
        `DELETE FROM public.invoice_provider_lines
         WHERE invoice_id = $1::uuid
           AND NOT (provider_id = ANY($2::uuid[]))`,
        [invoiceId, keepIds],
      )
    } else {
      // Either per-provider mode is off or no providers had data — keep the line table empty for
      // this invoice so the client can rely on "per-provider mode on AND at least one line exists".
      await pool.query(
        `DELETE FROM public.invoice_provider_lines WHERE invoice_id = $1::uuid`,
        [invoiceId],
      )
    }
  }
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

async function requireSuperAdmin(callerId: string): Promise<boolean> {
  const q = await pool.query<{ role: string }>(
    `SELECT role FROM public.users WHERE id = $1::uuid LIMIT 1`,
    [callerId],
  )
  return q.rows[0]?.role === 'super_admin'
}

/** POST /api/recompute-invoices-for-month  { month, year }
 * Recomputes invoices for every clinic that has provider_pay or provider_sheets in that month/year.
 */
serviceRoutes.post('/recompute-invoices-for-month', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!(await requireSuperAdmin(callerId))) {
    res.status(403).json({ error: 'Super admin only' })
    return
  }
  const month = Number(req.body?.month)
  const year = Number(req.body?.year)
  if (!Number.isFinite(month) || !Number.isFinite(year)) {
    res.status(400).json({ error: 'Missing or invalid month or year' })
    return
  }
  try {
    const pairsQ = await pool.query<{ clinic_id: string }>(
      `SELECT DISTINCT clinic_id FROM (
         SELECT clinic_id FROM public.provider_sheets WHERE month = $1 AND year = $2
         UNION
         SELECT clinic_id FROM public.provider_pay WHERE month = $1 AND year = $2
       ) AS clinic_ids`,
      [month, year],
    )
    const results = await Promise.allSettled(
      pairsQ.rows.map((r) => recomputeClinicInvoice(r.clinic_id, month, year)),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    res.json({ success: true, total: pairsQ.rows.length, failed })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[invoice] recompute-invoices-for-month failed:', err)
    res.status(500).json({ error: 'Failed to recompute invoices' })
  }
})

/** POST /api/recompute-all-invoices
 * Backfill: recompute invoices for every clinic+month+year that has provider_pay or provider_sheets data.
 */
serviceRoutes.post('/recompute-all-invoices', async (req, res) => {
  const callerId = getUserIdFromBearer(req.headers.authorization)
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!(await requireSuperAdmin(callerId))) {
    res.status(403).json({ error: 'Super admin only' })
    return
  }
  try {
    const pairsQ = await pool.query<{ clinic_id: string; month: number; year: number }>(
      `SELECT DISTINCT clinic_id, month, year FROM (
         SELECT clinic_id, month, year FROM public.provider_sheets
         UNION
         SELECT clinic_id, month, year FROM public.provider_pay
       ) AS periods
       ORDER BY year, month`,
    )
    const results = await Promise.allSettled(
      pairsQ.rows.map((r) => recomputeClinicInvoice(r.clinic_id, r.month, r.year)),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    res.json({
      success: true,
      total: pairsQ.rows.length,
      failed,
      periods: pairsQ.rows.length,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[invoice] recompute-all-invoices failed:', err)
    res.status(500).json({ error: 'Failed to recompute invoices' })
  }
})
