/**
 * Helper functions for converting data to/from Handsontable format
 */

/**
 * Convert array of objects to 2D array for Handsontable
 */
export function convertToHandsontableData<T extends Record<string, any>>(
  data: T[],
  columns: string[]
): any[][] {
  return data.map(item => columns.map(col => item[col] ?? ''))
}

/**
 * Convert 2D array back to array of objects
 */
export function convertFromHandsontableData<T extends Record<string, any>>(
  data: any[][],
  columns: string[],
  originalData: T[]
): T[] {
  return data.map((row, index) => {
    const obj: any = { ...originalData[index] }
    columns.forEach((col, colIndex) => {
      obj[col] = row[colIndex] ?? null
    })
    return obj as T
  })
}

/**
 * Create Handsontable columns configuration from field definitions
 */
export function createHandsontableColumns(
  fields: Array<{
    data: string
    title: string
    type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'autocomplete'
    width?: number
    readOnly?: boolean
    selectOptions?: string[]
    format?: string
  }>
) {
  return fields.map((field, index) => ({
    data: index,
    title: field.title,
    type: field.type || 'text',
    width: field.width,
    readOnly: field.readOnly,
    ...(field.type === 'dropdown' && field.selectOptions ? {
      editor: 'select',
      selectOptions: field.selectOptions,
      strict: true,
    } : {}),
    ...(field.type === 'date' ? {
      dateFormat: field.format || 'YYYY-MM-DD',
      correctFormat: true,
    } : {}),
    ...(field.type === 'numeric' ? {
      numericFormat: {
        pattern: field.format || '0.00',
      },
    } : {}),
  }))
}
