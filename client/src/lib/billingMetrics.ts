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
  /** Cancellations and reschedulings combined into one tally (per Jenali — tracked as a single
   *  category since both represent appointments that didn't go ahead but weren't no-shows). */
  cancellationsReschedulings: number
  paidClaims: number
  privatePay: number
  secondary: number
  ccDeclines: number
}

/**
 * Compute billing sheet metrics from sheet rows (for dashboard and provider sheet).
 * - visits: # of rows completed (# of rows with appointment date / completed)
 * - noShows: # of "No Show" under Appt status (plus pre-rename legacy values)
 * - cancellationsReschedulings: # of Cancellation OR Rescheduled under Appt status
 * - paidClaims: # of Paid under Claim Status
 * - privatePay: # of "PP Complete" under Appt status (the new home — Jenali's spec). Historic
 *   rows that used `claim_status = 'PP'` (the pre-rename Claim Status value, removed from the
 *   dropdown) are still counted as a fallback so the metric stays accurate on legacy data.
 * - secondary: # of Secondary under Pt Pay Status
 * - ccDeclines: # of CC decline under Pt Pay Status
 */
export function computeBillingMetrics(rows: SheetRow[]): BillingMetrics {
  let visits = 0
  let noShows = 0
  let cancellationsReschedulings = 0
  let paidClaims = 0
  let privatePay = 0
  let secondary = 0
  let ccDeclines = 0

  for (const row of rows) {
    if (row.appointment_date != null && String(row.appointment_date).trim() !== '') {
      visits += 1
    }
    if (isNoShowLc(row.appointment_status)) noShows += 1
    if (row.appointment_status === 'Cancellation' || row.appointment_status === 'Rescheduled') {
      cancellationsReschedulings += 1
    }
    if (row.claim_status === 'Paid') paidClaims += 1
    // Primary signal for Private Pay is the "PP Complete" appointment status. Legacy
    // `claim_status === 'PP'` rows (the pre-rename Claim Status value, no longer in the dropdown)
    // are also counted so historic data stays accurate. Cast to string because 'PP' was removed
    // from the ClaimStatus union.
    if (row.appointment_status === 'PP Complete' || (row.claim_status as string | null) === 'PP') {
      privatePay += 1
    }
    if (row.patient_pay_status === 'Secondary') secondary += 1
    if (row.patient_pay_status === 'CC declined') ccDeclines += 1
  }

  return { visits, noShows, cancellationsReschedulings, paidClaims, privatePay, secondary, ccDeclines }
}
