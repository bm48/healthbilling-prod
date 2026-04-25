import { apiClient } from '@/lib/apiClient'

/**
 * Fetches clinic_addresses for the given clinic IDs and returns a map of clinic_id to an array
 * of 6 address lines (index 0 = line 1, etc.). Missing lines are empty strings.
 */
export async function fetchClinicAddressesByClinicIds(
  clinicIds: string[]
): Promise<Record<string, string[]>> {
  if (clinicIds.length === 0) return {}
  const { data, error } = await apiClient
    .from('clinic_addresses')
    .select('clinic_id, line_index, address')
    .in('clinic_id', clinicIds)
    .order('line_index')
  if (error) {
    console.error('Error fetching clinic_addresses:', error)
    return {}
  }
  const map: Record<string, string[]> = {}
  clinicIds.forEach((id) => {
    map[id] = ['', '', '', '', '', '']
  })
  ;(data || []).forEach((row: { clinic_id: string; line_index: number; address: string | null }) => {
    const i = row.line_index - 1
    if (i >= 0 && i < 6 && map[row.clinic_id]) {
      map[row.clinic_id][i] = row.address ?? ''
    }
  })
  return map
}
