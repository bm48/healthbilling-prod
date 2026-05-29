import type { SheetRow } from '@/types'

/**
 * "No Show" appointment statuses that contribute to the No Shows tally.
 * - 'No Show' is the current label (post-rename).
 * - 'Charge NS/LC' / 'NS/LC - Charge' are pre-rename legacy values left in here so existing rows
 *   keep counting until the rename migration is run. After the SQL migration runs they will all be
 *   normalized to 'No Show'.
 * - 'Rescheduled' and 'Cancellation' (and their pre-rename equivalents) intentionally do NOT count
 *   — per the product spec they are separate categories from no-shows.
 */
const NS_LC_STATUSES = [
  'No Show',
  'Charge NS/LC',
  'NS/LC - Charge',
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
    // 'PP' was the legacy "Private Pay" label; it's been removed from the ClaimStatus union but
    // historic rows in the DB may still hold the value, so cast to string and keep counting them.
    if ((row.claim_status as string | null) === 'PP') privatePay += 1
    if (row.patient_pay_status === 'Secondary') secondary += 1
    if (row.patient_pay_status === 'CC declined') ccDeclines += 1
  }

  return { visits, noShows, paidClaims, privatePay, secondary, ccDeclines }
}
