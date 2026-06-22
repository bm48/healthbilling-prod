import { StatusColor } from '@/types'

// Shared default status colors used when the `status_colors` table is unseeded or the fetch fails.
// Includes month entries so MonthYearTabs can colorize even on pages whose API call returns nothing
// (previously ProviderSheetPage's local fallback only had a couple of appointment rows, leaving
// the month buttons rendered in default slate-grey).
export function getDefaultStatusColors(): StatusColor[] {
  return [
    // Appointment Status Colors
    { id: '1', status: 'Complete', color: '#22c55e', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
    { id: '2', status: 'PP Complete', color: '#3b82f6', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
    { id: '3', status: 'No Show', color: '#f59e0b', text_color: '#000000', type: 'appointment', created_at: '', updated_at: '' },
    { id: '4', status: 'Rescheduled', color: '#ef4444', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
    { id: '5', status: 'Cancellation', color: '#6b7280', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },
    { id: '6', status: 'Note not complete', color: '#dc2626', text_color: '#ffffff', type: 'appointment', created_at: '', updated_at: '' },

    // Claim Status Colors
    { id: '7', status: 'Claim Sent', color: '#3b82f6', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
    { id: '8', status: 'RS', color: '#f59e0b', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
    { id: '9', status: 'IP', color: '#eab308', text_color: '#000000', type: 'claim', created_at: '', updated_at: '' },
    { id: '10', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
    { id: '11', status: 'Deductible', color: '#a855f7', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
    { id: '12', status: 'N/A', color: '#6b7280', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
    { id: '13', status: 'Pending Pay', color: '#06b6d4', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
    { id: '14', status: 'Denial', color: '#ef4444', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
    { id: '15', status: 'Rejected', color: '#dc2626', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },
    { id: '16', status: 'No Coverage', color: '#991b1b', text_color: '#ffffff', type: 'claim', created_at: '', updated_at: '' },

    // Patient Pay Status Colors
    { id: '17', status: 'Paid', color: '#22c55e', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
    { id: '18', status: 'CC declined', color: '#ef4444', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
    { id: '19', status: 'Secondary', color: '#3b82f6', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
    { id: '20', status: 'Refunded', color: '#f59e0b', text_color: '#000000', type: 'patient_pay', created_at: '', updated_at: '' },
    { id: '21', status: 'Payment Plan', color: '#a855f7', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },
    { id: '22', status: 'Waiting on Claims', color: '#6b7280', text_color: '#ffffff', type: 'patient_pay', created_at: '', updated_at: '' },

    // Month Colors
    { id: '23', status: 'January', color: '#dc2626', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '24', status: 'February', color: '#ec4899', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '25', status: 'March', color: '#f59e0b', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
    { id: '26', status: 'April', color: '#fde047', text_color: '#000000', type: 'month', created_at: '', updated_at: '' },
    { id: '27', status: 'May', color: '#84cc16', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '28', status: 'June', color: '#22c55e', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '29', status: 'July', color: '#06b6d4', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '30', status: 'August', color: '#0284c7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '31', status: 'September', color: '#6366f1', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '32', status: 'October', color: '#f97316', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '33', status: 'November', color: '#a855f7', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
    { id: '34', status: 'December', color: '#0ea5e9', text_color: '#ffffff', type: 'month', created_at: '', updated_at: '' },
  ]
}
