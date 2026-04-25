import type { SheetRow } from '@/types'

/** NS/LC (No Show / Late Cancel) appointment statuses – 3 categories under Appt status */
const NS_LC_STATUSES = [
  'Charge NS/LC',
  'RS No Charge',
  'NS No Charge',
  // UI dropdown display variants (in case stored differently)
  'NS/LC - Charge',
  'NS/LC/RS - No Charge',
  'NS/LC - No Charge',
]

function isNoShowLc(status: string | null): boolean {
  if (!status) return false
  return NS_LC_STATUSES.some((s) => s === status)
}

export interface BillingMetrics {
  visits: number
  noShows: number
  paidClaims: number
  privatePay: number
  secondary: number
  ccDeclines: number
}

/**
 * Compute billing sheet metrics from sheet rows (for dashboard and provider sheet).
 * - visits: # of rows completed (# of rows with appointment date / completed)
 * - noShows: # of NS/LC under Appt status (3 categories)
 * - paidClaims: # of Paid under Claim Status
 * - privatePay: # of PP under Claim Status
 * - secondary: # of Secondary under Pt Pay Status
 * - ccDeclines: # of CC decline under Pt Pay Status
 */
export function computeBillingMetrics(rows: SheetRow[]): BillingMetrics {
  let visits = 0
  let noShows = 0
  let paidClaims = 0
  let privatePay = 0
  let secondary = 0
  let ccDeclines = 0

  for (const row of rows) {
    if (row.appointment_date != null && String(row.appointment_date).trim() !== '') {
      visits += 1
    }
    if (isNoShowLc(row.appointment_status)) noShows += 1
    if (row.claim_status === 'Paid') paidClaims += 1
    if (row.claim_status === 'PP') privatePay += 1
    if (row.patient_pay_status === 'Secondary') secondary += 1
    if (row.patient_pay_status === 'CC declined') ccDeclines += 1
  }

  return { visits, noShows, paidClaims, privatePay, secondary, ccDeclines }
}
