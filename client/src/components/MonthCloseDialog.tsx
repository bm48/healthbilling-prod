import { useState } from 'react'
import { ProviderSheet } from '@/types'
import { Lock, X, AlertTriangle } from 'lucide-react'

interface MonthCloseDialogProps {
  sheet: ProviderSheet
  onClose: () => void
  onLock: (lockedColumns: string[]) => Promise<void>
}

const CRITICAL_COLUMNS = [
  { col: 'L', label: 'Insurance Payment' },
  { col: 'O', label: 'Collected from Patient' },
  { col: 'U', label: 'AR Columns (U-Z)' },
  { col: 'AC', label: 'Provider Payment (AC-AE)' },
]

export default function MonthCloseDialog({ sheet, onClose, onLock }: MonthCloseDialogProps) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [locking, setLocking] = useState(false)

  const handleToggleColumn = (col: string) => {
    if (col === 'U') {
      // Toggle all AR columns U-Z
      const arColumns = ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA']
      if (selectedColumns.some(c => arColumns.includes(c))) {
        setSelectedColumns(selectedColumns.filter(c => !arColumns.includes(c)))
      } else {
        setSelectedColumns([...selectedColumns, ...arColumns])
      }
    } else if (col === 'AC') {
      // Toggle all Provider Payment columns AC-AE
      const ppColumns = ['AC', 'AD', 'AE']
      if (selectedColumns.some(c => ppColumns.includes(c))) {
        setSelectedColumns(selectedColumns.filter(c => !ppColumns.includes(c)))
      } else {
        setSelectedColumns([...selectedColumns, ...ppColumns])
      }
    } else {
      if (selectedColumns.includes(col)) {
        setSelectedColumns(selectedColumns.filter(c => c !== col))
      } else {
        setSelectedColumns([...selectedColumns, col])
      }
    }
  }

  const handleLock = async () => {
    if (selectedColumns.length === 0) {
      alert('Please select at least one column to lock')
      return
    }

    setLocking(true)
    try {
      await onLock(selectedColumns)
      onClose()
    } catch (error) {
      alert('Failed to lock columns. Please try again.')
    } finally {
      setLocking(false)
    }
  }

  const isColumnGroupSelected = (col: string) => {
    if (col === 'U') {
      const arColumns = ['U', 'V', 'W', 'X', 'Y', 'Z', 'AA']
      return arColumns.every(c => selectedColumns.includes(c))
    }
    if (col === 'AC') {
      const ppColumns = ['AC', 'AD', 'AE']
      return ppColumns.every(c => selectedColumns.includes(c))
    }
    return selectedColumns.includes(col)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Lock className="text-orange-600" size={24} />
            <h2 className="text-xl font-semibold text-gray-900">Month Close - Lock Columns</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
            <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">Warning: Locking columns</p>
              <p>Locked columns will prevent text editing but will still allow color/highlight changes. Only Super Admin can unlock these columns after locking.</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-3">
              Select columns to lock for {new Date(sheet.year, sheet.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}:
            </p>
            <div className="space-y-2">
              {CRITICAL_COLUMNS.map(({ col, label }) => (
                <label
                  key={col}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isColumnGroupSelected(col)}
                    onChange={() => handleToggleColumn(col)}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-900">{label}</span>
                  {col === 'U' && (
                    <span className="text-xs text-gray-500">(Columns U-Z, AA)</span>
                  )}
                  {col === 'AC' && (
                    <span className="text-xs text-gray-500">(Columns AC-AE)</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleLock}
              disabled={locking || selectedColumns.length === 0}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Lock size={16} />
              {locking ? 'Locking...' : 'Lock Selected Columns'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
