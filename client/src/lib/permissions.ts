import { UserRole } from '@/types'

export interface ColumnPermission {
  visible: boolean
  editable: boolean
}

export function getColumnPermissions(role: UserRole, isOwnSheet: boolean, lockedColumns: string[]): Record<string, ColumnPermission> {
  const isLocked = (column: string) => lockedColumns.includes(column)
  
  const permissions: Record<string, ColumnPermission> = {}

  // Columns A-G: Scheduling
  const canEditA_G = ['super_admin', 'admin', 'office_staff', 'billing_staff'].includes(role) || 
                     (role === 'provider' && isOwnSheet)
  permissions['A'] = { visible: true, editable: canEditA_G && !isLocked('A') }
  permissions['B'] = { visible: true, editable: canEditA_G && !isLocked('B') }
  permissions['C'] = { visible: true, editable: canEditA_G && !isLocked('C') }
  permissions['D'] = { visible: true, editable: canEditA_G && !isLocked('D') }
  permissions['E'] = { visible: true, editable: canEditA_G && !isLocked('E') }
  permissions['F'] = { visible: true, editable: canEditA_G && !isLocked('F') }
  permissions['G'] = { visible: true, editable: canEditA_G && !isLocked('G') }

  // Columns H-I: Provider billing
  const canEditH_I = ['super_admin', 'admin', 'billing_staff'].includes(role) || 
                     (role === 'provider' && isOwnSheet)
  permissions['H'] = { visible: true, editable: canEditH_I && !isLocked('H') }
  permissions['I'] = { visible: true, editable: canEditH_I && !isLocked('I') }

  // Columns J-M: Claim status (collapsible)
  const canEditJ_M = ['super_admin', 'admin', 'billing_staff'].includes(role)
  permissions['J'] = { visible: true, editable: canEditJ_M && !isLocked('J') }
  permissions['K'] = { visible: true, editable: canEditJ_M && !isLocked('K') }
  permissions['L'] = { visible: true, editable: canEditJ_M && !isLocked('L') }
  permissions['M'] = { visible: true, editable: canEditJ_M && !isLocked('M') }

  // Columns N-Q: Patient invoice/payment
  const canEditN_Q = ['super_admin', 'admin', 'billing_staff', 'office_staff'].includes(role)
  permissions['N'] = { visible: true, editable: canEditN_Q && !isLocked('N') }
  permissions['O'] = { visible: true, editable: canEditN_Q && !isLocked('O') }
  permissions['P'] = { visible: true, editable: canEditN_Q && !isLocked('P') }
  permissions['Q'] = { visible: true, editable: canEditN_Q && !isLocked('Q') }

  // Columns U-AA: Accounts Receivable (Admin only)
  const canEditU_AA = ['super_admin', 'admin'].includes(role)
  permissions['U'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('U') }
  permissions['V'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('V') }
  permissions['W'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('W') }
  permissions['X'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('X') }
  permissions['Y'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('Y') }
  permissions['Z'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('Z') }
  permissions['AA'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('AA') }

  // Columns AC-AE: Provider Payment (Admin only)
  permissions['AC'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('AC') }
  permissions['AD'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('AD') }
  permissions['AE'] = { visible: canEditU_AA, editable: canEditU_AA && !isLocked('AE') }

  // View-only roles
  if (role === 'view_only_admin' || role === 'view_only_billing') {
    Object.keys(permissions).forEach(key => {
      permissions[key].editable = false
    })
  }

  return permissions
}

export function getVisibleColumns(role: UserRole): string[] {
  if (role === 'provider') {
    return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
  }
  if (role === 'office_staff') {
    return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'O', 'P', 'Q']
  }
  // All other roles see all columns
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AC', 'AD', 'AE']
}
