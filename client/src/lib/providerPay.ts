import { apiClient } from '@/lib/apiClient'

/**
 * Fetch Provider Pay for a given clinic, provider, and month.
 * Returns { payDate, payPeriod, rows } or null if none exists.
 * rows is a 2D array [row_index][0=description, 1=amount, 2=notes]; row 0 is the header row.
 * payroll: 1 or 2 when clinic has two pay periods; default 1.
 */
export async function fetchProviderPay(
  clinicId: string,
  providerId: string,
  year: number,
  month: number,
  payroll: number = 1
): Promise<{ payDate: string; payPeriod: string; notes: string; wholeSheetLocked: boolean; rows: string[][] } | null> {
  const { data: header, error: headerError } = await apiClient
    .from('provider_pay')
    .select('id, pay_date, pay_period, notes, whole_sheet_locked')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .eq('year', year)
    .eq('month', month)
    .eq('payroll', payroll)
    .maybeSingle()

  if (headerError) {
    console.error('[fetchProviderPay] Error fetching provider_pay:', headerError)
    return null
  }
  if (!header) return null

  const { data: rowsData, error: rowsError } = await apiClient
    .from('provider_pay_rows')
    .select('row_index, description, amount, notes')
    .eq('provider_pay_id', header.id)
    .order('row_index', { ascending: true })

  if (rowsError) {
    console.error('[fetchProviderPay] Error fetching provider_pay_rows:', rowsError)
    return {
      payDate: header.pay_date ?? '',
      payPeriod: header.pay_period ?? '',
      notes: header.notes ?? '',
      wholeSheetLocked: Boolean((header as { whole_sheet_locked?: boolean }).whole_sheet_locked),
      rows: buildEmptyRows(),
    }
  }

  const rows = buildRowsFromDb(rowsData ?? [])
  return {
    payDate: header.pay_date ?? '',
    payPeriod: header.pay_period ?? '',
    notes: header.notes ?? '',
    wholeSheetLocked: Boolean((header as { whole_sheet_locked?: boolean }).whole_sheet_locked),
    rows,
  }
}

/**
 * Set whole-sheet lock for a provider pay header (past periods). Creates a header row if none exists.
 */
export async function updateProviderPayWholeSheetLocked(
  clinicId: string,
  providerId: string,
  year: number,
  month: number,
  payroll: number,
  locked: boolean
): Promise<void> {
  const { data: existing, error: fetchError } = await apiClient
    .from('provider_pay')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .eq('year', year)
    .eq('month', month)
    .eq('payroll', payroll)
    .maybeSingle()

  if (fetchError) {
    console.error('[updateProviderPayWholeSheetLocked] fetch error:', fetchError)
    throw fetchError
  }

  if (existing) {
    const { error: updateError } = await apiClient
      .from('provider_pay')
      .update({ whole_sheet_locked: locked, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (updateError) throw updateError
    return
  }

  const { error: insertError } = await apiClient.from('provider_pay').insert({
    clinic_id: clinicId,
    provider_id: providerId,
    year,
    month,
    payroll,
    pay_date: null,
    pay_period: null,
    notes: null,
    whole_sheet_locked: locked,
  })
  if (insertError) throw insertError
}

/**
 * Save Provider Pay for a given clinic, provider, and month.
 * Upserts the header and replaces all rows for that header.
 * payroll: 1 or 2 when clinic has two pay periods; default 1.
 */
export async function saveProviderPay(
  clinicId: string,
  providerId: string,
  year: number,
  month: number,
  payDate: string,
  payPeriod: string,
  tableData: string[][],
  notes: string,
  payroll: number = 1
): Promise<void> {
  const { data: existing, error: fetchError } = await apiClient
    .from('provider_pay')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .eq('year', year)
    .eq('month', month)
    .eq('payroll', payroll)
    .maybeSingle()

  if (fetchError) {
    console.error('[saveProviderPay] Error fetching existing provider_pay:', fetchError)
    throw fetchError
  }

  let providerPayId: string
  if (existing) {
    const { error: updateError } = await apiClient
      .from('provider_pay')
      .update({
        pay_date: payDate || null,
        pay_period: payPeriod || null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (updateError) throw updateError
    providerPayId = existing.id
  } else {
    const { data: inserted, error: insertError } = await apiClient
      .from('provider_pay')
      .insert({
        clinic_id: clinicId,
        provider_id: providerId,
        year,
        month,
        payroll,
        pay_date: payDate || null,
        pay_period: payPeriod || null,
        notes: notes || null,
        whole_sheet_locked: false,
      })
      .select('id')
      .single()
    if (insertError) throw insertError
    providerPayId = inserted.id
  }

  // Replace all rows: delete existing, insert new (never leave header without lines — use template if state was empty)
  const effectiveTable = tableData.length > 0 ? tableData : buildEmptyRows()
  const rowsToInsert = effectiveTable.map((row, rowIndex) => ({
    provider_pay_id: providerPayId,
    row_index: rowIndex,
    description: row[0] ?? null,
    amount: row[1] ?? null,
    notes: row[2] ?? null,
  }))

  const { error: deleteError } = await apiClient.from('provider_pay_rows').delete().eq('provider_pay_id', providerPayId)
  if (deleteError) {
    console.error('[saveProviderPay] Error deleting provider_pay_rows:', deleteError)
    throw deleteError
  }

  // Insert rows one-by-one. Bulk insert currently fails intermittently in this stack
  // with provider_pay_id null errors, while single-row inserts are stable.
  for (const row of rowsToInsert) {
    const { error: rowErr } = await apiClient.from('provider_pay_rows').insert(row)
    if (rowErr) {
      console.error('[saveProviderPay] Row insert failed at row_index', row.row_index, rowErr)
      throw rowErr
    }
  }
}

const DEFAULT_ROW_TEMPLATE: string[][] = [
  ['Description', 'Amount', 'Notes'],
  ['Patient Payments', '', ''],
  ['Insurance Payments', '', ''],
  ['A/R Payments', '', ''],
  ['', '', ''],
  ['Total Payments', '', ''],
  ['Provider Cut', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
]

function buildEmptyRows(): string[][] {
  return DEFAULT_ROW_TEMPLATE.map((r) => [...r])
}

interface RowRecord {
  row_index: number
  description: string | null
  amount: string | null
  notes: string | null
}

function buildRowsFromDb(rowsData: RowRecord[]): string[][] {
  if (rowsData.length === 0) return buildEmptyRows()
  const maxIndex = Math.max(...rowsData.map((r) => r.row_index), 0)
  const rows: string[][] = []
  for (let i = 0; i <= maxIndex; i++) {
    const r = rowsData.find((x) => x.row_index === i)
    rows.push([
      r?.description ?? '',
      r?.amount ?? '',
      r?.notes ?? '',
    ])
  }
  // Ensure we have at least the template shape; pad with empty rows if needed
  while (rows.length < DEFAULT_ROW_TEMPLATE.length) {
    rows.push(['', '', ''])
  }
  // Keep fixed row labels stable even if older DB rows stored blank descriptions.
  const fixedDescriptionRows = [0, 1, 2, 3, 5, 6]
  for (const rowIndex of fixedDescriptionRows) {
    if (!rows[rowIndex]) rows[rowIndex] = ['', '', '']
    if (!String(rows[rowIndex][0] ?? '').trim()) {
      rows[rowIndex][0] = DEFAULT_ROW_TEMPLATE[rowIndex]?.[0] ?? ''
    }
  }
  return rows
}
