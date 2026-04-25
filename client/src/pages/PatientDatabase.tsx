import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/lib/apiClient'
import { Patient } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { Search, Trash2 } from 'lucide-react'
import { useDebouncedSave } from '@/lib/useDebouncedSave'

export default function PatientDatabase() {
  const { userProfile } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (userProfile?.role === 'provider') {
      navigate('/providers', { replace: true })
    }
  }, [userProfile?.role, navigate])
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingCell, setEditingCell] = useState<{ patientId: string | 'new'; field: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; patientId: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const fetchPatients = useCallback(async () => {
    if (!userProfile) {
      setLoading(false)
      return
    }

    try {
      let query = apiClient
        .from('patients')
        .select('*')
        .order('last_name', { ascending: true })

      // For super_admin, fetch all patients. For others, filter by clinic_ids
      if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length > 0) {
        query = query.in('clinic_id', userProfile.clinic_ids)
      } else if (userProfile.role !== 'super_admin' && userProfile.clinic_ids.length === 0) {
        // Non-super_admin with no clinic_ids - no patients to show
        setPatients([])
        setLoading(false)
        return
      }

      const { data, error } = await query
      if (error) throw error
      const list = data || []
      setPatients(list)
      // Comprehensive log: how data from DB looks when loaded on patient info page
      console.log('[PatientData] FETCH from database:', {
        source: 'PatientDatabase',
        role: userProfile.role,
        totalRows: list.length,
        columns: list.length > 0 ? Object.keys(list[0]) : [],
        sampleRow: list.length > 0 ? { id: list[0].id, patient_id: list[0].patient_id, first_name: list[0].first_name, last_name: list[0].last_name, clinic_id: list[0].clinic_id } : null,
      })
    } catch (error) {
      console.error('[PatientData] Error fetching patients:', error)
    } finally {
      setLoading(false)
    }
  }, [userProfile])

  useEffect(() => {
    fetchPatients()
  }, [fetchPatients])

  const savePatients = useCallback(async (patientsToSave: Patient[]) => {
    if (!userProfile) {
      console.log('[PatientDatabase savePatients] SKIP: no userProfile')
      return
    }

    // Determine clinic_id: use first clinic_id from user, or handle super_admin
    let clinicId: string | null = null
    if (userProfile.role === 'super_admin') {
      clinicId = userProfile.clinic_ids?.[0] || null
    } else {
      if (!userProfile.clinic_ids?.[0]) {
        console.warn('[PatientDatabase savePatients] Cannot save: No clinic assigned')
        return
      }
      clinicId = userProfile.clinic_ids[0]
    }

    console.log('[PatientDatabase savePatients] START', { role: userProfile.role, clinicId, totalInBatch: patientsToSave.length })

    try {
      const newPatientsToCreate: Patient[] = []
      const patientsToUpdate: Patient[] = []

      // Separate new and existing patients
      for (const patient of patientsToSave) {
        if (patient.id.startsWith('new-')) {
          if (patient.patient_id || (patient.first_name && patient.last_name)) {
            newPatientsToCreate.push(patient)
          }
        } else {
          const originalPatient = patients.find(p => p.id === patient.id)
          if (originalPatient) {
            const hasChanged =
              originalPatient.patient_id !== patient.patient_id ||
              originalPatient.first_name !== patient.first_name ||
              originalPatient.last_name !== patient.last_name ||
              originalPatient.subscriber_id !== patient.subscriber_id ||
              originalPatient.insurance !== patient.insurance ||
              originalPatient.copay !== patient.copay ||
              originalPatient.coinsurance !== patient.coinsurance

            if (hasChanged) {
              patientsToUpdate.push(patient)
            }
          }
        }
      }

      console.log('[PatientDatabase savePatients] SPLIT', { toCreate: newPatientsToCreate.length, toUpdate: patientsToUpdate.length })
      console.log('[PatientDatabase savePatients] toCreate rows:', newPatientsToCreate.map((p, i) => ({ index: i, id: p.id, patient_id: p.patient_id, name: `${p.first_name} ${p.last_name}`, clinic_id: p.clinic_id })))
      console.log('[PatientDatabase savePatients] toUpdate rows:', patientsToUpdate.map((p, i) => ({ index: i, id: p.id, patient_id: p.patient_id, name: `${p.first_name} ${p.last_name}` })))

      // Create new patients
      for (let idx = 0; idx < newPatientsToCreate.length; idx++) {
        const patient = newPatientsToCreate[idx]
        console.log(`[PatientDatabase savePatients] CREATE ROW ${idx + 1}/${newPatientsToCreate.length}`, { id: patient.id, patient_id: patient.patient_id, name: `${patient.first_name} ${patient.last_name}` })

        const patientClinicId = patient.clinic_id || clinicId
        if (!patientClinicId) {
          console.error(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} SKIP: No clinic_id`, patient)
          continue
        }

        let finalPatientId = patient.patient_id || ''
        if (!finalPatientId) {
          const timestamp = Date.now().toString().slice(-6)
          const initials = `${(patient.first_name || '').charAt(0)}${(patient.last_name || '').charAt(0)}`.toUpperCase() || 'PT'
          finalPatientId = `${initials}${timestamp}`
          console.log(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} generated patient_id:`, finalPatientId)
        }

        const { data: existingPatient, error: checkError } = await apiClient
          .from('patients')
          .select('id')
          .eq('clinic_id', patientClinicId)
          .eq('patient_id', finalPatientId)
          .maybeSingle()

        if (checkError && checkError.code !== 'PGRST116') {
          console.error(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} check existing error:`, checkError)
          throw checkError
        }

        if (existingPatient) {
          const updatePayload = {
            first_name: patient.first_name || '',
            last_name: patient.last_name || '',
            subscriber_id: patient.subscriber_id || null,
            insurance: patient.insurance || null,
            copay: patient.copay || null,
            coinsurance: patient.coinsurance || null,
            date_of_birth: patient.date_of_birth || null,
            phone: patient.phone || null,
            email: patient.email || null,
            address: patient.address || null,
          }
          console.log(`[PatientData] PAYLOAD SENT TO DATABASE (UPDATE existing) row ${idx + 1} id=${existingPatient.id}:`, JSON.stringify(updatePayload, null, 2))
          const { error: updateError } = await apiClient
            .from('patients')
            .update(updatePayload)
            .eq('id', existingPatient.id)

          if (updateError) {
            console.error(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} update existing error:`, updateError)
            throw updateError
          }
          console.log(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} update existing OK`)
        } else {
          const insertPayload = {
            patient_id: finalPatientId,
            first_name: patient.first_name || '',
            last_name: patient.last_name || '',
            subscriber_id: patient.subscriber_id || null,
            insurance: patient.insurance || null,
            copay: patient.copay || null,
            coinsurance: patient.coinsurance || null,
            date_of_birth: patient.date_of_birth || null,
            phone: patient.phone || null,
            email: patient.email || null,
            address: patient.address || null,
            clinic_id: patientClinicId,
          }
          console.log(`[PatientData] PAYLOAD SENT TO DATABASE (INSERT) row ${idx + 1}:`, JSON.stringify(insertPayload, null, 2))
          const { error: insertError } = await apiClient
            .from('patients')
            .insert(insertPayload)

          if (insertError) {
            if (insertError.code === '23505') {
              console.log(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} duplicate (23505), finding and updating`)
              const { data: existingPatientData, error: findError } = await apiClient
                .from('patients')
                .select('id')
                .eq('clinic_id', patientClinicId)
                .eq('patient_id', finalPatientId)
                .maybeSingle()

              if (findError && findError.code !== 'PGRST116') {
                console.error(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} find after duplicate error:`, findError)
                throw insertError
              }

              if (existingPatientData) {
                const { error: updateError } = await apiClient
                  .from('patients')
                  .update({
                    first_name: patient.first_name || '',
                    last_name: patient.last_name || '',
                    subscriber_id: patient.subscriber_id || null,
                    insurance: patient.insurance || null,
                    copay: patient.copay || null,
                    coinsurance: patient.coinsurance || null,
                    date_of_birth: patient.date_of_birth || null,
                    phone: patient.phone || null,
                    email: patient.email || null,
                    address: patient.address || null,
                  })
                  .eq('id', existingPatientData.id)

                if (updateError) {
                  console.error(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} update after duplicate error:`, updateError)
                  throw updateError
                }
                console.log(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} update after duplicate OK`)
              } else {
                throw insertError
              }
            } else {
              console.error(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} insert error:`, insertError)
              throw insertError
            }
          } else {
            console.log(`[PatientDatabase savePatients] CREATE ROW ${idx + 1} INSERT OK`)
          }
        }
      }

      // Update existing patients
      for (let idx = 0; idx < patientsToUpdate.length; idx++) {
        const patient = patientsToUpdate[idx]
        const updatePayload = {
          patient_id: patient.patient_id,
          first_name: patient.first_name,
          last_name: patient.last_name,
          subscriber_id: patient.subscriber_id || null,
          insurance: patient.insurance || null,
          copay: patient.copay || null,
          coinsurance: patient.coinsurance || null,
          date_of_birth: patient.date_of_birth || null,
          phone: patient.phone || null,
          email: patient.email || null,
          address: patient.address || null,
        }
        console.log(`[PatientData] PAYLOAD SENT TO DATABASE (UPDATE) row ${idx + 1}/${patientsToUpdate.length} id=${patient.id}:`, JSON.stringify(updatePayload, null, 2))
        const { error } = await apiClient
          .from('patients')
          .update(updatePayload)
          .eq('id', patient.id)

        if (error) {
          console.error(`[PatientDatabase savePatients] UPDATE ROW ${idx + 1} error:`, error)
          throw error
        }
        console.log(`[PatientDatabase savePatients] UPDATE ROW ${idx + 1} OK`)
      }

      if (newPatientsToCreate.length > 0 || patientsToUpdate.length > 0) {
        console.log('[PatientData] Refreshing list from database after save (fetchPatients)')
        await fetchPatients()
      }
      console.log('[PatientData] SAVE COMPLETE — data stored in database:', { created: newPatientsToCreate.length, updated: patientsToUpdate.length })
    } catch (error: any) {
      console.error('[PatientData] SAVE FAILED — error writing to database:', error)
      let errorMessage = 'Failed to save patient. Please try again.'
      
      if (error?.code === '23505') {
        errorMessage = 'A patient with this Patient ID already exists for this clinic. The patient has been updated instead.'
      } else if (error?.message) {
        errorMessage = `Error: ${error.message}`
      }
      
      alert(errorMessage)
    }
  }, [userProfile, patients, fetchPatients])

  const { saveImmediately } = useDebouncedSave<Patient[]>(savePatients, patients, 1000, editingCell !== null)

  const handleUpdatePatient = useCallback((patientId: string, field: string, value: any) => {
    // Log every user input so super admin can trace what was typed → what gets stored
    console.log('[PatientData] USER INPUT (cell edit):', { patientId, field, value, valueType: typeof value })
    setPatients(prevPatients => {
      return prevPatients.map(patient => {
        if (patient.id === patientId) {
          return { ...patient, [field]: value }
        }
        return patient
      })
    })
  }, [])

  const handleAddNewRow = useCallback(() => {
    const tempId = `new-${Date.now()}`
    const newPatient: Patient = {
      id: tempId,
      patient_id: '',
      first_name: '',
      last_name: '',
      subscriber_id: null,
      insurance: null,
      copay: null,
      coinsurance: null,
      date_of_birth: null,
      phone: null,
      email: null,
      address: null,
      clinic_id: userProfile?.clinic_ids[0] || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setPatients(prev => [newPatient, ...prev])
    setEditingCell({ patientId: tempId, field: 'patient_id' })
  }, [userProfile])

  const handleDelete = async (patient: Patient) => {
    if (!confirm(`Are you sure you want to delete ${patient.first_name} ${patient.last_name}?`)) {
      return
    }

    try {
      console.log('[PatientData] DELETE from database:', { id: patient.id, patient_id: patient.patient_id, name: `${patient.first_name} ${patient.last_name}` })
      const { error } = await apiClient
        .from('patients')
        .delete()
        .eq('id', patient.id)

      if (error) throw error
      console.log('[PatientData] DELETE success, refreshing list')
      await fetchPatients()
    } catch (error) {
      console.error('[PatientData] Error deleting patient:', error)
      alert('Failed to delete patient. Please try again.')
    }
  }

  const filteredPatients = patients.filter(patient =>
    `${patient.first_name} ${patient.last_name} ${patient.patient_id} ${patient.subscriber_id || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const canEdit = ['office_staff', 'billing_staff', 'admin', 'super_admin'].includes(userProfile?.role || '')

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent, patientId: string) => {
    if (!canEdit) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, patientId })
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [contextMenu])

  // Handle delete from context menu
  const handleContextMenuDelete = (patientId: string) => {
    const patient = patients.find(p => p.id === patientId)
    if (patient) {
      handleDelete(patient)
    }
    setContextMenu(null)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-white">Patient Database</h1>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-lg shadow-xl p-6 border border-white/20">
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/50" size={20} />
            <input
              type="text"
              placeholder="Search patients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-white/70">Loading...</div>
        ) : (
          <div className="table-container dark-theme">
            <table className="table-spreadsheet dark-theme">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Subscriber ID</th>
                  <th>Insurance</th>
                  <th>Copay</th>
                  <th>Coinsurance</th>
                  {canEdit && (
                    <th style={{ width: 'auto', minWidth: '60px' }}>Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {canEdit && (
                  <tr className="editing" onClick={handleAddNewRow} style={{ cursor: 'pointer' }}>
                    <td colSpan={canEdit ? 8 : 7} style={{ textAlign: 'center', fontStyle: 'italic', color: 'rgba(255,255,255,0.5)' }}>
                      Click here to add a new patient row
                    </td>
                  </tr>
                )}
                {filteredPatients.map((patient) => {
                  const isNew = patient.id.startsWith('new-')
                  return (
                    <tr 
                      key={patient.id} 
                      className={isNew ? 'editing' : ''}
                      onContextMenu={(e) => canEdit && !isNew && handleContextMenu(e, patient.id)}
                    >
                      <td>
                        <input
                          type="text"
                          value={patient.patient_id || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'patient_id', e.target.value)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'ID' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            fontFamily: 'monospace', 
                            fontSize: '12px',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.first_name || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'first_name', e.target.value)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'First Name' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.last_name || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'last_name', e.target.value)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'Last Name' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            fontWeight: 500,
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.subscriber_id || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'subscriber_id', e.target.value || null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'Subscriber ID' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.insurance || ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'insurance', e.target.value || null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full patient-input-edit"
                          placeholder={canEdit ? 'Insurance' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.copay ?? ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'copay', e.target.value.trim() || null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full currency patient-input-edit"
                          placeholder={canEdit ? '0.00 or N/A' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            textAlign: 'right',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={patient.coinsurance ?? ''}
                          onChange={(e) => handleUpdatePatient(patient.id, 'coinsurance', e.target.value.trim() || null)}
                          onBlur={() => saveImmediately()}
                          disabled={!canEdit}
                          className="w-full currency patient-input-edit"
                          placeholder={canEdit ? '0.00 or N/A' : '-'}
                          style={{ 
                            color: '#000000', 
                            backgroundColor: canEdit ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
                            textAlign: 'right',
                            border: 'none',
                            outline: 'none'
                          }}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            onClick={() => handleDelete(patient)}
                            className="text-red-400 hover:text-red-300"
                            style={{ padding: '4px' }}
                            disabled={isNew}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {filteredPatients.length === 0 && !canEdit && (
                  <tr className="empty-row">
                    <td colSpan={7}>
                      No patients found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-slate-800 border border-white/20 rounded-lg shadow-xl z-50 py-1 min-w-[150px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <button
            onClick={() => handleContextMenuDelete(contextMenu.patientId)}
            className="w-full text-left px-4 py-2 text-red-400 hover:bg-white/10 flex items-center gap-2"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
