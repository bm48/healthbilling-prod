import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { fetchSheetRows } from '@/lib/providerSheetRows'
import { useAuth } from '@/contexts/AuthContext'
import { Download, Loader } from 'lucide-react'
import {
  generateProviderReport,
  generateClinicReport,
  generateClaimReport,
  generatePatientInvoiceReport,
  generateLaborReport,
  getDateRange,
} from '@/lib/reports'
import { ProviderSheet, Timecard, User, Clinic } from '@/types'

export default function Reports() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [reportType, setReportType] = useState('provider')
  const [timeFilter, setTimeFilter] = useState('month')
  const [selectedClinic, setSelectedClinic] = useState<string>('')
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (userProfile?.role === 'provider') {
      navigate('/providers', { replace: true })
    }
  }, [userProfile?.role, navigate])

  useEffect(() => {
    fetchClinics()
  }, [userProfile])

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
      // Error fetching clinics
    }
  }

  const handleGenerateReport = async () => {
    if (!userProfile) return

    setGenerating(true)
    try {
      const { startDate, endDate } = getDateRange(timeFilter)
      
      // Fetch data based on report type
      let sheets: ProviderSheet[] = []
      let timecards: Timecard[] = []
      let users: User[] = []
      let clinicsData: Clinic[] = []

      // Fetch users (active only so inactive users do not appear in reports)
      const { data: usersData } = await apiClient.from('users').select('*').eq('active', true)
      users = usersData || []

      // Fetch clinics
      const { data: clinicsDataResult } = await apiClient.from('clinics').select('*')
      clinicsData = clinicsDataResult || []

      // Fetch sheets
      let sheetsQuery = apiClient
        .from('provider_sheets')
        .select('*')
        .gte('year', startDate.getFullYear())
        .lte('year', endDate.getFullYear())

      if (selectedClinic) {
        sheetsQuery = sheetsQuery.eq('clinic_id', selectedClinic)
      } else if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        sheetsQuery = sheetsQuery.in('clinic_id', userProfile.clinic_ids)
      }

      const { data: sheetsData } = await sheetsQuery
      sheets = (sheetsData || []).filter(sheet => {
        const sheetDate = new Date(sheet.year, sheet.month - 1, 1)
        return sheetDate >= startDate && sheetDate <= endDate
      })

      const rowsBySheetId: Record<string, import('@/types').SheetRow[]> = {}
      await Promise.all(sheets.map(async sheet => {
        rowsBySheetId[sheet.id] = await fetchSheetRows(apiClient, sheet.id)
      }))

      // Fetch timecards for labor report
      if (reportType === 'labor') {
        let timecardsQuery = apiClient
          .from('timecards')
          .select('*')
          .gte('clock_in', startDate.toISOString())
          .lte('clock_in', endDate.toISOString())

        if (userProfile.role !== 'super_admin') {
          // Only fetch timecards for billing staff in user's clinics
          const billingStaffIds = users
            .filter(u => u.role === 'billing_staff' && 
              (userProfile.clinic_ids.some(cid => u.clinic_ids.includes(cid)) || userProfile.id === u.id))
            .map(u => u.id)
          
          if (billingStaffIds.length > 0) {
            timecardsQuery = timecardsQuery.in('user_id', billingStaffIds)
          } else {
            timecards = []
          }
        }

        if (timecards.length === 0 || userProfile.role === 'super_admin') {
          const { data: timecardsData } = await timecardsQuery
          timecards = timecardsData || []
        }
      }

      let pdf: any

      switch (reportType) {
        case 'provider':
          pdf = await generateProviderReport(sheets, users, { startDate, endDate, clinicId: selectedClinic }, rowsBySheetId)
          break
        case 'clinic':
          pdf = await generateClinicReport(sheets, users, clinicsData, { startDate, endDate }, rowsBySheetId)
          break
        case 'claim':
          pdf = await generateClaimReport(sheets, { startDate, endDate, clinicId: selectedClinic }, rowsBySheetId)
          break
        case 'patient':
          pdf = await generatePatientInvoiceReport(sheets, { startDate, endDate, clinicId: selectedClinic }, rowsBySheetId)
          break
        case 'labor':
          pdf = await generateLaborReport(timecards, users, { startDate, endDate })
          break
        default:
          throw new Error('Invalid report type')
      }

      const fileName = `${reportType}_report_${new Date().toISOString().split('T')[0]}.pdf`
      pdf.save(fileName)
    } catch (error) {
      alert('Failed to generate report. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const reportTypes = [
    { value: 'provider', label: 'By Provider' },
    { value: 'clinic', label: 'By Clinic' },
    { value: 'claim', label: 'By Claim' },
    { value: 'patient', label: 'By Patient Invoices' },
    { value: 'labor', label: 'By Labor' },
  ]

  const timeFilters = [
    { value: 'month', label: 'This Month' },
    { value: 'quarter', label: 'This Quarter' },
    { value: 'ytd', label: 'Year to Date' },
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-6">Reports</h1>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Report Type
            </label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full px-4 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              {reportTypes.map((type) => (
                <option key={type.value} value={type.value} className="bg-slate-900">
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/90 mb-2">
              Time Period
            </label>
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              className="w-full px-4 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              {timeFilters.map((filter) => (
                <option key={filter.value} value={filter.value} className="bg-slate-900">
                  {filter.label}
                </option>
              ))}
            </select>
          </div>

          {(reportType === 'provider' || reportType === 'claim' || reportType === 'patient') && clinics.length > 0 && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white/90 mb-2">
                Clinic (optional)
              </label>
              <select
                value={selectedClinic}
                onChange={(e) => setSelectedClinic(e.target.value)}
                className="w-full px-4 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="" className="bg-slate-900">All Clinics</option>
                {clinics.map(clinic => (
                  <option key={clinic.id} value={clinic.id} className="bg-slate-900">{clinic.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          onClick={handleGenerateReport}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <>
              <Loader className="animate-spin" size={20} />
              Generating...
            </>
          ) : (
            <>
              <Download size={20} />
              Generate & Download PDF
            </>
          )}
        </button>
      </div>
    </div>
  )
}
