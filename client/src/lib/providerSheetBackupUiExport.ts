import type { Patient, SheetRow } from '@/types'
import { toDisplayValue, toDisplayDate } from '@/lib/utils'

/** Layout flags must match `ProvidersTab` column / row mapping. */
export type ProviderSheetUiExportLayout = {
  showVisitTypeColumn: boolean
  officeStaffView: boolean
  isProviderView: boolean
  providerLevel: 1 | 2
  isCondensed: boolean
}

/** Build a patient_id → Patient lookup. Exported so callers can memoize and reuse it across renders
 *  instead of paying the O(patients) build on every matrix/snapshot call. */
export function coPatientByIdKey(patients: Patient[]): Map<string, Patient> {
  const m = new Map<string, Patient>()
  for (const p of patients) {
    const k = String(p.patient_id ?? '').trim().toLowerCase()
    if (k) m.set(k, p)
  }
  return m
}

function escapeCsvCell(val: string | number | boolean): string {
  const s = String(val ?? '')
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** Same header order as `ProvidersTab` `columnTitles` for the given layout. */
export function providerSheetUiExportHeaders(layout: ProviderSheetUiExportLayout): string[] {
  const { showVisitTypeColumn, officeStaffView, isProviderView, providerLevel, isCondensed } = layout
  const showCondenseButton = !officeStaffView && !isProviderView

  const columnTitlesFullBase = [
    'ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins',
    'Date of Service', 'CPT Code', 'Appt/Note Status', 'Claim Status', 'Most Recent Submit Date',
    'Ins Pay', 'Ins Pay Date', 'PT RES', 'Collected from PT', 'PT Pay Status',
    'PT Payment AR Ref Date', 'Total', 'Notes',
  ]
  const columnTitlesFull = showVisitTypeColumn
    ? [...columnTitlesFullBase.slice(0, 9), 'Visit Type', ...columnTitlesFullBase.slice(9)]
    : columnTitlesFullBase

  const columnTitlesProviderView = showVisitTypeColumn
    ? ['ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins', 'Date of Service', 'CPT Code', 'Appt/Note Status', 'Visit Type']
    : ['ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins', 'Date of Service', 'CPT Code', 'Appt/Note Status']

  const columnTitlesOfficeStaffBase = [
    'ID', 'First Name', 'LI', 'Insurance', 'Co-pay', 'Co-Ins',
    'Date of Service', 'CPT Code', 'Appt/Note Status',
    'Collected from PT', 'PT Pay Status', 'PT Payment AR Ref Date',
  ]
  const columnTitlesOfficeStaff = showVisitTypeColumn
    ? [...columnTitlesOfficeStaffBase.slice(0, 9), 'Visit Type', ...columnTitlesOfficeStaffBase.slice(9)]
    : columnTitlesOfficeStaffBase

  if (officeStaffView) return columnTitlesOfficeStaff
  if (isProviderView) return providerLevel === 2 ? columnTitlesFull : columnTitlesProviderView
  return showCondenseButton && isCondensed ? columnTitlesFull.slice(0, 9) : columnTitlesFull
}

/**
 * Mirrors `ProvidersTab` grid row mapping so backup CSV matches on-screen data
 * (patient columns from `patients` by `patient_id`, same as the table).
 */
export function sheetRowsToUiMatrix(
  rows: SheetRow[],
  patients: Patient[],
  layout: ProviderSheetUiExportLayout,
  /** Optional pre-built patient_id → Patient map, e.g. memoized at the component level so we don't
   *  rebuild it on every render / matrix call. Falls back to building from `patients` if omitted. */
  patientLookup?: Map<string, Patient>
): (string | number | boolean)[][] {
  const { showVisitTypeColumn, officeStaffView, isProviderView, providerLevel, isCondensed } = layout
  const showCondenseButton = !officeStaffView && !isProviderView
  const coPatients = patientLookup ?? coPatientByIdKey(patients)

  return rows.map((row) => {
    const patientDisplay = toDisplayValue(row.patient_id)
    const pidKey = String(row.patient_id ?? '').trim().toLowerCase()
    const coPatient = pidKey ? coPatients.get(pidKey) : undefined
    const firstNameDisplay = toDisplayValue(coPatient ? coPatient.first_name : row.patient_first_name)
    const lastNameSource = coPatient ? coPatient.last_name : row.patient_last_name
    const lastInitialDisplay = toDisplayValue(lastNameSource ? String(lastNameSource).charAt(0) : row.last_initial)
    const insuranceDisplay = toDisplayValue(coPatient ? coPatient.insurance : row.patient_insurance)
    const copayDisplay = toDisplayValue(coPatient ? coPatient.copay : row.patient_copay)
    const coinsuranceDisplay = toDisplayValue(coPatient ? coPatient.coinsurance : row.patient_coinsurance)
    const visitTypeVal = () => row.visit_type === 'Telehealth'
    const insertVisitType = (arr: (string | number | boolean)[]) =>
      showVisitTypeColumn ? [...arr.slice(0, 9), visitTypeVal(), ...arr.slice(9)] : arr

    if (officeStaffView) {
      const base = [
        patientDisplay,
        firstNameDisplay,
        lastInitialDisplay,
        insuranceDisplay,
        copayDisplay,
        coinsuranceDisplay,
        toDisplayDate(row.appointment_date),
        toDisplayValue(row.cpt_code),
        toDisplayValue(row.appointment_status),
        toDisplayValue(row.collected_from_patient),
        toDisplayValue(row.patient_pay_status),
        toDisplayValue(row.ar_date),
      ]
      return insertVisitType(base) as (string | number | boolean)[]
    }
    if (isProviderView && providerLevel !== 2) {
      const base = [
        patientDisplay,
        firstNameDisplay,
        lastInitialDisplay,
        insuranceDisplay,
        copayDisplay,
        coinsuranceDisplay,
        toDisplayDate(row.appointment_date),
        toDisplayValue(row.cpt_code),
        toDisplayValue(row.appointment_status),
      ]
      return insertVisitType(base) as (string | number | boolean)[]
    }
    if (isProviderView && providerLevel === 2) {
      const base = [
        patientDisplay,
        firstNameDisplay,
        lastInitialDisplay,
        insuranceDisplay,
        copayDisplay,
        coinsuranceDisplay,
        toDisplayDate(row.appointment_date),
        toDisplayValue(row.cpt_code),
        toDisplayValue(row.appointment_status),
        toDisplayValue(row.claim_status),
        toDisplayValue(row.submit_date),
        toDisplayValue(row.insurance_payment),
        toDisplayValue(row.payment_date),
        toDisplayValue(row.insurance_adjustment),
        toDisplayValue(row.collected_from_patient),
        toDisplayValue(row.patient_pay_status),
        toDisplayValue(row.ar_date),
        toDisplayValue(row.total),
        toDisplayValue(row.notes),
      ]
      return insertVisitType(base) as (string | number | boolean)[]
    }
    const fullRow = [
      patientDisplay,
      firstNameDisplay,
      lastInitialDisplay,
      insuranceDisplay,
      copayDisplay,
      coinsuranceDisplay,
      toDisplayDate(row.appointment_date),
      toDisplayValue(row.cpt_code),
      toDisplayValue(row.appointment_status),
      toDisplayValue(row.claim_status),
      toDisplayValue(row.submit_date),
      toDisplayValue(row.insurance_payment),
      toDisplayValue(row.payment_date),
      toDisplayValue(row.insurance_adjustment),
      toDisplayValue(row.collected_from_patient),
      toDisplayValue(row.patient_pay_status),
      toDisplayValue(row.ar_date),
      toDisplayValue(row.total),
      toDisplayValue(row.notes),
    ]
    const withVisitType = insertVisitType(fullRow) as (string | number | boolean)[]
    if (showCondenseButton && isCondensed) return withVisitType.slice(0, showVisitTypeColumn ? 10 : 9)
    return withVisitType
  })
}

function isRowAllBlankForTrim(row: (string | number | boolean)[]): boolean {
  return row.every((c) => {
    if (typeof c === 'boolean') return !c
    const s = c == null ? '' : String(c).trim()
    return s === '' || s.toLowerCase() === 'null'
  })
}

function formatCellForCsv(c: string | number | boolean): string {
  if (typeof c === 'boolean') return c ? 'TRUE' : ''
  return escapeCsvCell(c)
}

/** CSV with header row; trailing blank rows (padding) trimmed. */
export function sheetRowsToUiCsv(rows: SheetRow[], patients: Patient[], layout: ProviderSheetUiExportLayout): string {
  const matrix = sheetRowsToUiMatrix(rows, patients, layout)
  while (matrix.length > 0 && isRowAllBlankForTrim(matrix[matrix.length - 1]!)) {
    matrix.pop()
  }
  const headers = providerSheetUiExportHeaders(layout)
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of matrix) {
    lines.push(row.map(formatCellForCsv).join(','))
  }
  return lines.join('\n')
}
