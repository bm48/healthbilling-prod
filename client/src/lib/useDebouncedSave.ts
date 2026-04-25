import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * Custom hook for debounced auto-save functionality
 * Automatically saves data after user stops typing/editing
 * @param isEditing - If true, prevents debounced saves (only saves on explicit saveImmediately call)
 */
export function useDebouncedSave<T>(
  saveFn: (data: T) => Promise<void>,
  data: T,
  delay: number = 1000,
  isEditing: boolean = false
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = useCallback(async () => {
    const dataString = JSON.stringify(data)
    
    // Don't save if data hasn't changed
    if (dataString === lastSavedRef.current) {
      return
    }

    // Don't save if already saving
    if (isSaving) {
      return
    }

    try {
      setIsSaving(true)
      await saveFn(data)
      lastSavedRef.current = dataString
    } catch (error) {
      console.error('Error saving:', error)
      // Don't update lastSavedRef on error so it will retry
    } finally {
      setIsSaving(false)
    }
  }, [data, saveFn, isSaving])

  useEffect(() => {
    // Don't set timeout if currently editing - only save on blur/explicit save
    if (isEditing) {
      // Clear any pending timeout when editing starts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    // Don't set timeout if data hasn't actually changed
    const dataString = JSON.stringify(data)
    if (dataString === lastSavedRef.current) {
      return
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      save()
    }, delay)

    // Cleanup on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [data, delay, save, isEditing])

  // Force immediate save (useful for blur events)
  const saveImmediately = useCallback(async () => {
    // console.log('saveImmediately: Called', { isSaving, isEditing })
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    
    // Don't save if already saving
    if (isSaving) {
      console.log('saveImmediately: Already saving, skipping')
      return
    }

    // Force save on blur - always attempt save regardless of lastSavedRef
    // This ensures user changes are saved when they blur
    // console.log("data: ",data)
    const dataString = JSON.stringify(data)
    // console.log("dataString: ",dataString)
    try {
      setIsSaving(true)
      // console.log('saveImmediately: Calling saveFn', { dataString: dataString.substring(0, 100) })
      await saveFn(data)
      lastSavedRef.current = dataString
      // console.log('saveImmediately: Save successful')
    } catch (error) {
      // console.error('saveImmediately: Error saving:', error)
      // Don't update lastSavedRef on error so it will retry
    } finally {
      setIsSaving(false)
    }
  }, [saveFn, data, isSaving])

  // Reset the last saved state (useful after fetching fresh data)
  const resetLastSaved = useCallback(() => {
    lastSavedRef.current = JSON.stringify(data)
  }, [data])

  // Update last saved with specific data (useful after saving)
  const updateLastSaved = useCallback((savedData: T) => {
    lastSavedRef.current = JSON.stringify(savedData)
  }, [])

  return { saveImmediately, isSaving, resetLastSaved, updateLastSaved }
}
