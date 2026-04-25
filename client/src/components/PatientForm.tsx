import { useState } from 'react'
import { Patient } from '@/types'
import { X } from 'lucide-react'

interface PatientFormProps {
  patient: Patient | null
  clinicId: string
  onClose: () => void
  onSave: (patient: Partial<Patient>) => Promise<void>
}

export default function PatientForm({ patient, onClose, onSave }: PatientFormProps) {
  const [formData, setFormData] = useState({
    patient_id: patient?.patient_id || '',
    first_name: patient?.first_name || '',
    last_name: patient?.last_name || '',
    date_of_birth: patient?.date_of_birth || '',
    phone: patient?.phone || '',
    email: patient?.email || '',
    address: patient?.address || '',
    insurance: patient?.insurance || '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    // Log form data as entered by user before it is sent to save/database
    console.log('[PatientData] USER INPUT (form submit):', {
      source: 'PatientForm',
      mode: patient ? 'edit' : 'create',
      patientId: patient?.id ?? 'new',
      formData: { ...formData },
    })
    try {
      await onSave(formData)
      console.log('[PatientData] Form save completed — data passed to onSave (parent handles DB write)')
      onClose()
    } catch (error) {
      console.error('[PatientData] Form save failed:', error)
      alert('Failed to save patient. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800/95 backdrop-blur-md rounded-lg shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-white/20">
        <div className="sticky top-0 bg-slate-800/95 backdrop-blur-md border-b border-white/20 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-white">
            {patient ? 'Edit Patient' : 'Add New Patient'}
          </h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1">
                Patient ID *
              </label>
              <input
                type="text"
                required
                value={formData.patient_id}
                onChange={(e) => setFormData({ ...formData, patient_id: e.target.value })}
                className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-1">
                Date of Birth
              </label>
              <input
                type="date"
                value={formData.date_of_birth}
                onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1">
                First Name *
              </label>
              <input
                type="text"
                required
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-1">
                Last Name *
              </label>
              <input
                type="text"
                required
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/90 mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/90 mb-1">
              Address
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/90 mb-1">
              Insurance
            </label>
            <input
              type="text"
              value={formData.insurance}
              onChange={(e) => setFormData({ ...formData, insurance: e.target.value })}
              className="w-full px-3 py-2 border border-white/20 bg-white/10 backdrop-blur-sm text-white rounded-lg focus:ring-2 focus:ring-primary-500 placeholder-white/50"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/20">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-white/70 bg-white/10 hover:bg-white/20 rounded-lg border border-white/20"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : patient ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
