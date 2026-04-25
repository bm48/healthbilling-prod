# Handsontable Integration Guide

This guide explains how to integrate Handsontable with keyboard shortcuts and formula support into your tables.

## Keyboard Shortcuts Supported

The Handsontable wrapper component supports all the standard keyboard shortcuts:

- **Arrow Keys** - Move between cells
- **Enter** - Edit cell
- **Tab** - Next cell
- **Shift+Arrow** - Select range
- **Ctrl+C / Ctrl+V** - Copy/Paste
- **Ctrl+Z** - Undo
- **Ctrl+Y** - Redo
- **Delete** - Clear cell content

## Components Created

1. **HandsontableWrapper.tsx** - Main wrapper component with all keyboard shortcuts enabled
2. **handsontableHelpers.ts** - Helper functions for data conversion

## Usage Example

Here's how to integrate Handsontable into the Patients table:

```typescript
import HandsontableWrapper from '@/components/HandsontableWrapper'
import { convertToHandsontableData, convertFromHandsontableData } from '@/lib/handsontableHelpers'

// In your component:
const patientColumns = ['patient_id', 'first_name', 'last_name', 'insurance', 'copay', 'coinsurance']
const patientData = convertToHandsontableData(patients, patientColumns)

const handsontableColumns = [
  { data: 0, title: 'Patient ID', type: 'text', width: 120 },
  { data: 1, title: 'Patient First', type: 'text', width: 150 },
  { data: 2, title: 'Patient Last', type: 'text', width: 150 },
  { data: 3, title: 'Insurance', type: 'text', width: 150 },
  { data: 4, title: 'Copay', type: 'numeric', width: 100, format: '0.00' },
  { data: 5, title: 'Coinsurance', type: 'numeric', width: 100, format: '0.00' },
]

const handlePatientsChange = (changes: Handsontable.CellChange[] | null, source: string) => {
  if (!changes || source === 'loadData') return
  
  changes.forEach(([row, col, oldValue, newValue]) => {
    const patient = patients[row]
    if (patient) {
      const field = patientColumns[col]
      handleUpdatePatient(patient.id, field, newValue)
    }
  })
  
  savePatientsImmediately()
}

// In your JSX:
<HandsontableWrapper
  data={patientData}
  columns={handsontableColumns}
  colHeaders={true}
  rowHeaders={true}
  width="100%"
  height={600}
  afterChange={handlePatientsChange}
  enableFormula={false} // Set to true to enable formulas
  readOnly={!canEdit}
/>
```

## Formula Support

To enable formula support with HyperFormula, set `enableFormula={true}`:

```typescript
<HandsontableWrapper
  data={data}
  columns={columns}
  enableFormula={true} // Enable formula support
  // ... other props
/>
```

With formulas enabled, you can use Excel-like formulas such as:
- `=SUM(A1:A10)` - Sum a range
- `=AVERAGE(B1:B5)` - Average a range
- `=A1+B1` - Add two cells
- And many more Excel-compatible formulas

## Integration Steps

1. Import the components
2. Convert your data to 2D array format
3. Define column configurations
4. Handle change events to sync with your state
5. Replace the existing table with HandsontableWrapper

## Notes

- The component maintains all existing functionality (save, delete, context menus)
- Keyboard shortcuts work out of the box
- Formula support is optional and can be enabled per table
- The component is fully typed with TypeScript
