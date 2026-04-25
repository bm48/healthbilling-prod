import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { useAuth } from '@/contexts/AuthContext'
import { Clinic, Provider } from '@/types'
import { FileText, Building2, User } from 'lucide-react'

export default function ProviderSheet() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const [clinics, setClinics] = useState<Clinic[]>([])
  const [providersByClinic, setProvidersByClinic] = useState<Record<string, Provider[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userProfile?.role === 'provider') {
      navigate('/providers', { replace: true })
      return
    }
    fetchData()
  }, [userProfile, navigate])

  const fetchData = async () => {
    if (!userProfile) return
    setLoading(true)
    try {
      let query = apiClient.from('clinics').select('*').order('name')
      if (
        (userProfile.role === 'admin' || userProfile.role === 'billing_staff' || userProfile.role === 'official_staff') &&
        userProfile.clinic_ids?.length
      ) {
        query = query.in('id', userProfile.clinic_ids)
      }
      const { data: clinicsData, error: clinicsError } = await query
      if (clinicsError) throw clinicsError
      const clinicsList = clinicsData || []
      setClinics(clinicsList)

      if (clinicsList.length === 0) {
        setProvidersByClinic({})
        return
      }

      const clinicIds = clinicsList.map((c) => c.id)
      const { data: providersData, error: providersError } = await apiClient
        .from('providers')
        .select('*')
        .overlaps('clinic_ids', clinicIds)
        .order('last_name')
        .order('first_name')

      if (providersError) throw providersError

      const grouped: Record<string, Provider[]> = {}
      clinicsList.forEach((c) => {
        grouped[c.id] = []
      })
      ;(providersData || []).forEach((p: Provider) => {
        (p.clinic_ids || []).forEach((cid: string) => {
          if (grouped[cid]) {
            grouped[cid].push(p)
          }
        })
      })
      setProvidersByClinic(grouped)
    } catch (error) {
      console.error('Error fetching data:', error)
      setClinics([])
      setProvidersByClinic({})
    } finally {
      setLoading(false)
    }
  }

  const handleOpenSheet = (clinicId: string, providerId: string) => {
    navigate(`/clinic/${clinicId}/providers/${providerId}`)
  }

  if (userProfile?.role === 'provider') {
    return null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    )
  }

  if (clinics.length === 0) {
    return (
      <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 border border-white/20">
        <p className="text-white mb-2">No clinics assigned. Contact your administrator.</p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
        <FileText size={32} />
        Provider Sheet
      </h1>
      <p className="text-white/80 mb-6">
        Click a provider to open their billing sheet.
      </p>

      <div className="space-y-8">
        {clinics.map((clinic) => {
          const providers = providersByClinic[clinic.id] || []
          return (
            <div key={clinic.id} className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl border border-white/20 overflow-hidden">
              <div className="px-6 py-4 border-b border-white/20 flex items-center gap-2">
                <Building2 size={20} className="text-primary-400" />
                <span className="text-xl font-semibold text-white">{clinic.name}</span>
              </div>
              <div className="p-4 grid gap-2">
                {providers.length === 0 ? (
                  <p className="text-white/60 text-sm py-2">No providers in this clinic.</p>
                ) : (
                  providers.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => handleOpenSheet(clinic.id, provider.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left bg-white/5 hover:bg-white/15 border border-white/10 hover:border-primary-400/50 transition-colors group"
                    >
                      <User size={20} className="text-white/70 group-hover:text-primary-400" />
                      <span className="font-medium text-white">
                        {provider.first_name} {provider.last_name}
                      </span>
                      {provider.specialty && (
                        <span className="text-white/60 text-sm">({provider.specialty})</span>
                      )}
                      <FileText size={16} className="ml-auto text-white/50 group-hover:text-primary-400" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
