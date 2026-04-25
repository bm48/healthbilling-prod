import { useState, useEffect } from 'react'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRows, saveSheetRows } from '@/lib/providerSheetRows'
import { useAuth } from '@/contexts/AuthContext'
import { ProviderSheet, Clinic } from '@/types'
import { Lock, Unlock, Calculator, Calendar } from 'lucide-react'
import MonthCloseDialog from '@/components/MonthCloseDialog'

export default function MonthCloseTab() {
  const { userProfile } = useAuth()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [sheets, setSheets] = useState<ProviderSheet[]>([])
  const [selectedClinic, setSelectedClinic] = useState<string>('')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [showMonthClose, setShowMonthClose] = useState(false)
  const [selectedSheet, setSelectedSheet] = useState<ProviderSheet | null>(null)

  useEffect(() => {
    if (userProfile) {
      fetchClinics()
    }
  }, [userProfile])

  useEffect(() => {
    if (selectedClinic) {
      fetchSheets()
    }
  }, [selectedClinic, selectedMonth, selectedYear])

  const fetchClinics = async () => {
    if (!userProfile) return

    try {
      let query = apiClient.from('clinics').select('*')

      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('id', userProfile.clinic_ids)
      }

      const { data, error } = await query
      if (error) throw error
      setClinics(data || [])
      if (data && data.length > 0 && !selectedClinic) {
        setSelectedClinic(data[0].id)
      }
    } catch (error) {
      console.error('Error fetching clinics:', error)
    }
  }

  const fetchSheets = async () => {
    if (!selectedClinic) return

    try {
      const { data, error } = await apiClient
        .from('provider_sheets')
        .select('*')
        .eq('clinic_id', selectedClinic)
        .eq('month', selectedMonth)
        .eq('year', selectedYear)

      if (error) throw error
      setSheets(data || [])
    } catch (error) {
      console.error('Error fetching sheets:', error)
    }
  }

  const handleLockColumns = async (lockedColumns: string[]) => {
    if (!selectedSheet) return

    try {
      const { error } = await apiClient
        .from('provider_sheets')
        .update({
          locked: true,
          locked_columns: lockedColumns,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedSheet.id)

      if (error) throw error
      await fetchSheets()
    } catch (error) {
      throw error
    }
  }

  const canUnlock = userProfile?.role === 'super_admin'

  const handleUnlockSheet = async (sheetId: string) => {
    if (!confirm('Are you sure you want to unlock this sheet? Only Super Admin can unlock.')) {
      return
    }

    try {
      const { error } = await apiClient
        .from('provider_sheets')
        .update({
          locked: false,
          locked_columns: [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', sheetId)

      if (error) throw error
      await fetchSheets()
    } catch (error) {
      console.error('Error unlocking sheet:', error)
      alert('Failed to unlock sheet. Please try again.')
    }
  }

  const calculateProviderPayments = async () => {
    if (!selectedClinic) {
      alert('Please select a clinic')
      return
    }

    try {
      for (const sheet of sheets) {
        const rows = await fetchSheetRows(apiClient, sheet.id)
        let totalInsurance = 0
        let totalPatient = 0
        let totalAR = 0

        rows.forEach((row: any) => {
          totalInsurance += parseFloat(String(row.insurance_payment)) || 0
          totalPatient += parseFloat(String(row.collected_from_patient)) || 0
          totalAR += row.ar_amount || 0
        })

        const providerPayment = (totalInsurance + totalPatient + totalAR) * 0.6
        const updatedRows = rows.map((row: any) => ({
          ...row,
          provider_payment_amount: rows.length ? providerPayment / rows.length : 0,
          provider_payment_date: new Date().toISOString().split('T')[0],
        }))

        await saveSheetRows(apiClient, sheet.id, updatedRows)
      }

      alert('Provider payments calculated successfully!')
      await fetchSheets()
    } catch (error) {
      alert('Failed to calculate provider payments. Please try again.')
    }
  }

  return (
    <div>
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white/10 rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Calendar size={20} />
            Month Close & Locking
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/90 mb-2">Clinic</label>
              <select
                value={selectedClinic}
                onChange={(e) => setSelectedClinic(e.target.value)}
                className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="" className="bg-slate-900">Select clinic...</option>
                {clinics.map(clinic => (
                  <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-2">Month</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m} className="bg-slate-900">
                      {new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/90 mb-2">Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            {sheets.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-white/90">Provider Sheets:</p>
                {sheets.map(sheet => (
                  <div key={sheet.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-sm text-white/90">
                      Sheet {new Date(sheet.year, sheet.month - 1).toLocaleString('default', { month: 'short' })} {sheet.year}
                    </span>
                    <div className="flex items-center gap-2">
                      {sheet.locked ? (
                        <>
                          <span className="text-xs text-orange-400 font-medium">Locked</span>
                          {canUnlock && (
                            <button
                              onClick={() => handleUnlockSheet(sheet.id)}
                              className="text-primary-400 hover:text-primary-300"
                              title="Unlock sheet"
                            >
                              <Unlock size={16} />
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedSheet(sheet)
                            setShowMonthClose(true)
                          }}
                          className="flex items-center gap-1 px-3 py-1 text-sm bg-orange-600 text-white rounded hover:bg-orange-700"
                        >
                          <Lock size={14} />
                          Lock
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white/10 rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Calculator size={20} />
            Provider Payment Calculation
          </h2>

          <p className="text-sm text-white/90 mb-4">
            Calculate provider payments based on insurance payments, patient payments, and AR for the selected month.
          </p>

          <button
            onClick={calculateProviderPayments}
            disabled={!selectedClinic || sheets.length === 0}
            className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Calculator size={18} />
            Calculate Provider Payments
          </button>
        </div>
      </div>

      {showMonthClose && selectedSheet && (
        <MonthCloseDialog
          sheet={selectedSheet}
          onClose={() => {
            setShowMonthClose(false)
            setSelectedSheet(null)
          }}
          onLock={handleLockColumns}
        />
      )}
    </div>
  )
}
