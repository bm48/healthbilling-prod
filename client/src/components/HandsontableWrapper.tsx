import { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { HotTable } from '@handsontable/react'
import Handsontable from 'handsontable'
import { HyperFormula, NoOperationToRedoError, NoOperationToUndoError } from 'hyperformula'
import { DateEditor, DropdownEditorOpenList } from '@/lib/handsontableCustomRenderers'
import 'handsontable/dist/handsontable.full.css'

/** 0-based row/col range for formula reference highlighting */
export type FormulaRefRange = { startRow: number; startCol: number; endRow: number; endCol: number }

/** Parse a formula string for cell references (e.g. B2:B4, A1) and return 0-based ranges. */
export function parseFormulaReferences(formula: string): FormulaRefRange[] {
  const ranges: FormulaRefRange[] = []
  if (typeof formula !== 'string' || !formula.startsWith('=')) return ranges

  const colLetterToIndex = (letters: string): number => {
    let n = 0
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64)
    }
    return n - 1
  }

  const rangeRegex = /([A-Z]+)(\d+):([A-Z]+)(\d+)/gi
  const rangeMatches = [...formula.matchAll(rangeRegex)]
  const seen = new Set<string>()

  for (const m of rangeMatches) {
    const startCol = colLetterToIndex(m[1].toUpperCase())
    const startRow = Math.max(0, parseInt(m[2], 10) - 1)
    const endCol = colLetterToIndex(m[3].toUpperCase())
    const endRow = Math.max(0, parseInt(m[4], 10) - 1)
    const rMin = Math.min(startRow, endRow)
    const rMax = Math.max(startRow, endRow)
    const cMin = Math.min(startCol, endCol)
    const cMax = Math.max(startCol, endCol)
    // Push every cell in the range so the first (and all) cells get the dotted highlight
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        seen.add(`${r}-${c}`)
        ranges.push({ startRow: r, startCol: c, endRow: r, endCol: c })
      }
    }
  }

  const singleRegex = /([A-Z]+)(\d+)/g
  let singleMatch
  while ((singleMatch = singleRegex.exec(formula)) !== null) {
    const col = colLetterToIndex(singleMatch[1].toUpperCase())
    const row = Math.max(0, parseInt(singleMatch[2], 10) - 1)
    const key = `${row}-${col}`
    if (seen.has(key)) continue
    seen.add(key)
    ranges.push({ startRow: row, startCol: col, endRow: row, endCol: col })
  }
  return ranges
}

/** Apply cell meta.style and optional title to all currently rendered (visible) cells. Call after render and after scroll so highlights persist. */
function applyCellStylesAndTitles(
  hot: Handsontable,
  getCellTitle?: (row: number, col: number) => string | undefined
) {
  const countRows = hot.countRows()
  const countCols = hot.countCols()
  for (let r = 0; r < countRows; r++) {
    for (let c = 0; c < countCols; c++) {
      const cell = hot.getCell(r, c) as HTMLElement | null
      if (cell) {
        const meta = hot.getCellMeta(r, c) as { style?: React.CSSProperties } | undefined
        if (meta?.style && typeof meta.style === 'object') {
          Object.assign(cell.style, meta.style)
        }
        if (getCellTitle) {
          const title = getCellTitle(r, c)
          if (title != null && title !== '') cell.setAttribute('title', title)
          else cell.removeAttribute('title')
        }
      }
    }
  }
}

/** Copy row heights from main table to row header clone so the row number column matches data row heights. */
function syncRowHeaderHeightsToClone(hot: Handsontable) {
  const root = hot?.rootElement
  if (!root) return
  const mainTbody = root.querySelector('.ht_master .wtHolder .wtHider table.htCore tbody') as HTMLElement | null
  const cloneTbody =
    (root.querySelector('.ht_clone_left .wtHolder .wtHider table.htCore tbody') as HTMLElement | null) ||
    (root.querySelector('.ht_clone_left table.htCore tbody') as HTMLElement | null)
  if (!mainTbody || !cloneTbody) return
  const mainRows = mainTbody.querySelectorAll('tr')
  const cloneRows = cloneTbody.querySelectorAll('tr')
  const count = Math.min(mainRows.length, cloneRows.length)
  for (let i = 0; i < count; i++) {
    const mainTr = mainRows[i] as HTMLTableRowElement
    const cloneTr = cloneRows[i] as HTMLTableRowElement
    const h = mainTr.offsetHeight
    if (h > 0) {
      cloneTr.style.height = `${h}px`
      cloneTr.style.minHeight = `${h}px`
    }
  }
}

/** For providers tab: measure column header row height and set CSS variable + corner cell/row height so row-number corner matches when header wraps. */
function syncColHeaderHeightForProviders(hot: Handsontable) {
  const root = hot?.rootElement as HTMLElement | undefined
  if (!root) return
  const headerRow =
    root.querySelector('.ht_clone_top table.htCore thead tr') as HTMLTableRowElement | null ||
    root.querySelector('.ht_master table.htCore thead tr') as HTMLTableRowElement | null
  if (!headerRow) return
  const height = headerRow.offsetHeight
  if (height <= 0) return
  const heightPx = `${height}px`
  const container = root.closest?.('.providers-handsontable') as HTMLElement | null
  if (container) container.style.setProperty('--ht-colheader-height', heightPx)
  root.style.setProperty('--ht-colheader-height', heightPx)
  const cornerCell =
    (root.querySelector('.ht_clone_left table.htCore thead tr th') as HTMLElement | null) ||
    (root.querySelector('.ht_clone_left table.htCore tr:first-child th') as HTMLElement | null)
  if (cornerCell) {
    cornerCell.style.setProperty('height', heightPx, 'important')
    cornerCell.style.setProperty('min-height', heightPx, 'important')
    const cornerRow = cornerCell.closest('tr') as HTMLTableRowElement | null
    if (cornerRow) {
      cornerRow.style.setProperty('height', heightPx, 'important')
      cornerRow.style.setProperty('min-height', heightPx, 'important')
    }
  }
}

interface HandsontableWrapperProps {
  data: any[][]
  columns: Array<{
    data: number | string
    title?: string
    type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'autocomplete' | 'checkbox'
    editor?: string | any
    renderer?: string | ((instance: any, td: HTMLElement, row: number, col: number, prop: string | number, value: any, cellProperties: any) => void)
    validator?: any
    selectOptions?: string[] | (() => string[])
    readOnly?: boolean | ((row: number, col: number) => boolean)
    width?: number
    className?: string
    format?: string
    numericFormat?: {
      pattern: string
      culture?: string
    }
    allowEmpty?: boolean
    source?: string[] | (() => string[])
    strict?: boolean
    /** When columnSorting is enabled, set { headerAction: false } to disable sorting on this column */
    columnSorting?: { headerAction?: boolean; indicator?: boolean; sortEmptyCells?: boolean }
  }>
  colHeaders?: boolean | string[]
  rowHeaders?: boolean | number[] | string[]
  width?: string | number
  height?: string | number
  stretchH?: 'all' | 'last' | 'none'
  licenseKey?: string
  afterChange?: (changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => void
  /** Called before changes are applied; can mutate the changes array in place (e.g. to fix fill copying wrong column). Receives hot instance as 3rd arg when available. Return false to cancel the entire batch (Handsontable beforeChange). */
  beforeChangeCorrect?: (
    changes: Handsontable.CellChange[] | null,
    source: Handsontable.ChangeSource,
    hotInstance?: Handsontable | null
  ) => void | false
  afterSelection?: (r: number, c: number, r2: number, c2: number) => void
  /** Called when the user deselects the grid (e.g. clicks outside the table). Use to trigger save on "leave table". */
  afterDeselect?: () => void
  cells?: (row: number, col: number) => any
  className?: string
  style?: React.CSSProperties
  enableFormula?: boolean
  onContextMenu?: (row: number, col: number, event: MouseEvent) => void
  /** Called when user chooses "Highlight" or "Remove highlight" from cell context menu (row/col are 0-based) */
  onCellHighlight?: (row: number, col: number) => void
  /** When provided, used to show "Remove highlight" vs "Highlight" when the cell is already highlighted */
  getCellIsHighlighted?: (row: number, col: number) => boolean
  /** Called when user chooses "See comment" from cell context menu (row/col are 0-based). When provided, menu shows only "See comment". */
  onCellSeeComment?: (row: number, col: number) => void
  /** Called when user chooses "Add comment" from cell context menu (row/col are 0-based) */
  onCellAddComment?: (row: number, col: number) => void
  /** Called when user chooses "Remove comment" from cell context menu (row/col are 0-based) */
  onCellRemoveComment?: (row: number, col: number) => void
  /** When provided with onCellAddComment, used to show "Remove comment" vs "Add comment" when the cell already has a comment */
  getCellHasComment?: (row: number, col: number) => boolean
  /** Optional tooltip text per cell (e.g. comment for provider); applied as td title on render */
  getCellTitle?: (row: number, col: number) => string | undefined
  readOnly?: boolean
  /** Bump when rows are added/removed so the grid refreshes (e.g. context-menu add/delete) */
  dataVersion?: number
  /** When this value changes, forces a full table render so column headers refresh (e.g. lock icons). */
  colHeaderRefreshKey?: string | number
  /** After each column header cell is built; use to inject icons (runs again after render). headerLevel is 0 for a single header row. */
  afterGetColHeader?: (col: number, TH: HTMLTableCellElement, headerLevel?: number) => void
  /** Forward Handsontable row structure hooks (e.g. sync React state after native context menu insert/remove). */
  afterCreateRow?: (index: number, amount: number, source?: string) => void
  afterRemoveRow?: (index: number, amount: number, physicalRows: number[], source?: string) => void
  /**
   * When true with onCellHighlight / comment menus, prepend native row + copy/cut + undo/redo items
   * (same as default grid menu) before custom cell items.
   */
  contextMenuWithNativeRows?: boolean
  /** Called when rows are reordered by drag (manualRowMove). movedRows = source indexes, finalIndex = index of first moved row after drop */
  onAfterRowMove?: (movedRows: number[], finalIndex: number) => void
  /** When set to a row index (0-based), the grid will scroll to that row after the next data/version update, then clear the ref */
  scrollToRowAfterUpdateRef?: React.MutableRefObject<number | null>
  /** Called after each table render (e.g. to inject custom header buttons) */
  afterRenderCallback?: (hot: Handsontable) => void
  /** Enable column sorting (default false). When true, columns are sortable unless column.allowSorting === false. */
  columnSorting?: boolean | Record<string, unknown>
  /** Optional ref to receive the Handsontable instance (e.g. to blur when opening a modal so focus stays in the modal). */
  hotInstanceRef?: React.MutableRefObject<Handsontable | null>
  /**
   * Called after Handsontable undo/redo completes. Use to sync React state from the grid without triggering
   * updateSettings({ data }) in the same tick (that would clear Handsontable's redo stack).
   */
  onAfterUndoRedoSync?: () => void
}

export default function HandsontableWrapper({
  data,
  columns,
  colHeaders = true,
  rowHeaders = true,
  width = '100%',
  height = 'auto',
  stretchH = 'all',
  afterChange,
  beforeChangeCorrect,
  afterSelection,
  afterDeselect,
  cells,
  className = '',
  style = {},
  enableFormula = false,
  onContextMenu,
  onCellHighlight,
  getCellIsHighlighted,
  onCellSeeComment,
  onCellAddComment,
  onCellRemoveComment,
  getCellHasComment,
  getCellTitle,
  readOnly = false,
  dataVersion = 0,
  colHeaderRefreshKey,
  afterGetColHeader,
  afterCreateRow,
  afterRemoveRow,
  contextMenuWithNativeRows = false,
  onAfterRowMove,
  scrollToRowAfterUpdateRef,
  afterRenderCallback,
  columnSorting: columnSortingProp = false,
  hotInstanceRef,
  onAfterUndoRedoSync,
}: HandsontableWrapperProps) {
  const decorateColHeaderRef = useRef(afterGetColHeader)
  decorateColHeaderRef.current = afterGetColHeader
  const hotTableRef = useRef<any>(null)
  const hyperformulaInstanceRef = useRef<HyperFormula | null>(null)
  const isBatchOperationRef = useRef<boolean>(false)
  /** True when the last selection was triggered by a mouse click (so we can open dropdown on single click) */
  const selectionFromMouseRef = useRef<boolean>(false)
  /** When enableFormula: ranges to highlight with dotted border while editing a formula cell */
  const [formulaRefRanges, setFormulaRefRanges] = useState<FormulaRefRange[]>([])
  /** Ref to editor input and listener so we can remove on afterFinishEditing and update highlight while typing */
  const formulaEditorInputRef = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; listener: () => void } | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  const prevDataLengthRef = useRef(data.length)
  const prevDataVersionRef = useRef(dataVersion)
  // Stable ref for settings.data so HotTable doesn't overwrite grid on every re-render (avoids stale data wiping typed input)
  const dataForSettingsRef = useRef(data)
  /** When true, skip one updateSettings({ data }) so HOT's undo/redo stack is not cleared by React resync */
  const suppressProgrammaticDataPushRef = useRef(false)
  /**
   * @handsontable/react calls updateSettings(fullSettings) on every parent re-render.
   * - Passing `data` reapplies the dataset (bad for redo).
   * - If `data` is omitted but `columns` is still present, Handsontable core runs datamap.createMap() +
   *   initIndexMappers() on every update (core.js), which also breaks redo after undo triggers setState.
   * After first paint, omit both from the settings object; push data via the effect below and columns via
   * the processedColumns effect only when those values actually change.
   */
  const [omitDataAndColumnsFromReactSettings, setOmitDataAndColumnsFromReactSettings] = useState(false)

  useLayoutEffect(() => {
    const enableOmit = () => {
      if (hotTableRef.current?.hotInstance) setOmitDataAndColumnsFromReactSettings(true)
    }
    enableOmit()
    const t = setTimeout(enableOmit, 0)
    return () => {
      clearTimeout(t)
      setOmitDataAndColumnsFromReactSettings(false)
    }
  }, [])

  const runUndoRedoSyncFromParent = () => {
    if (!onAfterUndoRedoSync) return
    suppressProgrammaticDataPushRef.current = true
    onAfterUndoRedoSync()
    // If only cell values changed, data.length/dataVersion may be unchanged so the data effect never runs;
    // clear suppress after two frames so a later real structure change is not wrongly skipped.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (suppressProgrammaticDataPushRef.current) {
          suppressProgrammaticDataPushRef.current = false
        }
      })
    })
  }

  // Create HyperFormula once when enableFormula is true so initial settings include formulas with a valid sheetName (string).
  // This prevents "Expected value of type: string for config parameter: sheetName" when the Formulas plugin runs on mount/update.
  //
  // Handsontable's Formulas plugin hooks beforeUndo/beforeRedo and always calls engine.undo()/redo(). HyperFormula keeps a
  // separate stack from Handsontable's UndoRedo; plain cell edits often only exist on HOT's stack, so HF.redo() throws
  // NoOperationToRedoError and breaks redo. Swallow those no-op cases so HOT can still apply its redo/undo action.
  const hyperformulaInstance = useMemo(() => {
    if (!enableFormula) return null
    const hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' })
    const origRedo = hf.redo.bind(hf)
    const origUndo = hf.undo.bind(hf)
    ;(hf as { redo: () => void }).redo = () => {
      try {
        return origRedo()
      } catch (e) {
        if (e instanceof NoOperationToRedoError) return
        throw e
      }
    }
    ;(hf as { undo: () => void }).undo = () => {
      try {
        return origUndo()
      } catch (e) {
        if (e instanceof NoOperationToUndoError) return
        throw e
      }
    }
    return hf
  }, [enableFormula])
  hyperformulaInstanceRef.current = hyperformulaInstance

  // Expose hot instance to parent (e.g. to blur when opening comment modal)
  useEffect(() => {
    if (!hotInstanceRef) return
    const sync = () => {
      hotInstanceRef!.current = hotTableRef.current?.hotInstance ?? null
    }
    const id = setTimeout(sync, 0)
    const id2 = setTimeout(sync, 150)
    return () => {
      clearTimeout(id)
      clearTimeout(id2)
      hotInstanceRef.current = null
    }
  }, [hotInstanceRef])

  useEffect(() => {
    const hotInstance = hotTableRef.current?.hotInstance
    // Push data when row count or dataVersion changes (e.g. month change, add/delete row); include empty data so table clears when switching to a month whose data is still loading
    const lengthChanged = prevDataLengthRef.current !== dataRef.current.length
    const versionChanged = prevDataVersionRef.current !== dataVersion
    if (hotInstance && (lengthChanged || versionChanged)) {
      if (suppressProgrammaticDataPushRef.current) {
        suppressProgrammaticDataPushRef.current = false
        prevDataLengthRef.current = dataRef.current.length
        prevDataVersionRef.current = dataVersion
        dataForSettingsRef.current = dataRef.current
        return
      }
      // Replacing data via updateSettings drops column sort state; re-apply so row delete/add doesn't scramble order
      let sortConfigsToRestore: Array<{ column: number; sortOrder: 'asc' | 'desc' }> | null = null
      try {
        const cs = hotInstance.getPlugin('columnSorting') as
          | {
              isEnabled?: () => boolean
              isSorted?: () => boolean
              getSortConfig?: () =>
                | { column: number; sortOrder: 'asc' | 'desc' }
                | Array<{ column: number; sortOrder: 'asc' | 'desc' }>
                | undefined
            }
          | undefined
        if (cs?.isEnabled?.() && cs?.isSorted?.()) {
          const cfg = cs.getSortConfig?.()
          if (cfg != null) {
            sortConfigsToRestore = Array.isArray(cfg) ? cfg.map((c) => ({ ...c })) : [{ ...cfg }]
          }
        }
      } catch {
        sortConfigsToRestore = null
      }

      prevDataLengthRef.current = dataRef.current.length
      prevDataVersionRef.current = dataVersion
      hotInstance.updateSettings({
        data: dataRef.current
      })
      dataForSettingsRef.current = dataRef.current

      if (sortConfigsToRestore && sortConfigsToRestore.length > 0) {
        const configs = sortConfigsToRestore
        requestAnimationFrame(() => {
          try {
            const hot = hotTableRef.current?.hotInstance as Handsontable | undefined
            if (!hot) return
            const cs = hot.getPlugin('columnSorting') as { sort: (c: unknown) => void } | undefined
            cs?.sort(configs.length === 1 ? configs[0] : configs)
          } catch {
            // ignore
          }
        })
      }

      // Scroll to requested row (e.g. after "Add row" so the new row is visible)
      const rowToScroll = scrollToRowAfterUpdateRef?.current
      if (typeof rowToScroll === 'number' && rowToScroll >= 0 && rowToScroll < dataRef.current.length) {
        if (scrollToRowAfterUpdateRef) scrollToRowAfterUpdateRef.current = null
        requestAnimationFrame(() => {
          try {
            hotInstance.selectCell(rowToScroll, 0, rowToScroll, 0, true)
          } catch {
            // ignore if instance or row no longer valid
          }
        })
      }
    } else {
      prevDataLengthRef.current = dataRef.current.length
      prevDataVersionRef.current = dataVersion
    }
  }, [data.length, dataVersion, scrollToRowAfterUpdateRef])

  // Lock icons / custom header markup: HOT does not always rebuild headers when only labels change.
  useEffect(() => {
    const hot = hotTableRef.current?.hotInstance
    if (hot && typeof hot.render === 'function') {
      hot.render()
    }
  }, [colHeaderRefreshKey])
  
  // Process columns to handle numeric type and custom renderers/editors
  const processedColumns = useMemo(() => columns.map(col => {
    const processedCol: any = { ...col }
    // Never pass empty string as type/editor — causes "createElement('')" InvalidCharacterError in DOM
    if (processedCol.type === '' || (typeof processedCol.type === 'string' && !processedCol.type.trim())) {
      processedCol.type = 'text' as const
    }
    if (processedCol.editor === '' || (typeof processedCol.editor === 'string' && !processedCol.editor.trim())) {
      delete processedCol.editor
    }

    if (col.type === 'numeric') {
      processedCol.type = 'text' as const // Use text type as base since numeric may not be registered
      processedCol.editor = 'text'
      // Numeric validation and formatting will be handled in the change handler
    }
    
    // Handle dropdown type: use Select editor only when explicitly requested; otherwise use Dropdown with editor that forces list to open
    if (col.type === 'dropdown' && col.selectOptions) {
      if (col.editor === 'select') {
        processedCol.type = 'text' as const
        processedCol.editor = 'select'
        processedCol.selectOptions = col.selectOptions
        processedCol.strict = col.strict !== false
      } else {
        processedCol.type = 'dropdown' as const
        processedCol.source = col.selectOptions
        processedCol.strict = col.strict !== false
        // Use custom editor that forces options list to open on single-click (unless column already has a custom editor e.g. MultiSelectCptEditor)
        if ((!col.editor || typeof col.editor !== 'function') && DropdownEditorOpenList) {
          processedCol.editor = DropdownEditorOpenList
        }
      }
    }
    
    // Handle date type - use text type with custom date editor (no external dependencies needed)
    if (col.type === 'date' || processedCol.type === 'date') {
      processedCol.type = 'text' as const // Use text type to avoid registration issues
      processedCol.editor = DateEditor // Use custom date editor with HTML5 date input
      // Store date format for potential use
      if (col.format) {
        processedCol.dateFormat = col.format
      } else {
        processedCol.dateFormat = 'YYYY-MM-DD'
      }
    }
    
    // Preserve custom renderer if provided
    if (typeof col.renderer === 'function') {
      processedCol.renderer = col.renderer
    }
    
    // Preserve custom editor if provided
    if (col.editor && typeof col.editor !== 'string') {
      processedCol.editor = col.editor
    }
    
    // Convert readOnly function to boolean if needed for Handsontable compatibility
    if (typeof processedCol.readOnly === 'function') {
      // Keep function-based readOnly, but ensure it's properly typed
      // Handsontable should support function-based readOnly
    }
    if (col.readOnly === undefined) {
      processedCol.readOnly = false
    } else if (col.readOnly === true) {
      processedCol.readOnly = true
    } else if (col.readOnly === false) {
      processedCol.readOnly = false
    }
    
    // Final safety check: ensure type is valid (never empty string)
    // Allow date, text, checkbox types, and undefined (for select editor)
    const t = processedCol.type
    if (!t || (typeof t === 'string' && t.trim() === '') || (t !== 'date' && t !== 'text' && t !== 'checkbox')) {
      if (processedCol.editor && processedCol.editor !== 'select' && processedCol.editor !== 'date') {
        processedCol.type = 'text' as const
      } else if (processedCol.editor === 'select') {
        delete processedCol.type
      } else {
        processedCol.type = 'text' as const
      }
    }

    return processedCol
  }), [columns])


  // Update columns when they change (e.g., when readOnly state changes)
  useEffect(() => {
    if (hotTableRef.current?.hotInstance && processedColumns.length > 0) {
      const hotInstance = hotTableRef.current.hotInstance
      hotInstance.updateSettings({
        columns: processedColumns
      })
    }
  }, [processedColumns])

  // Convert rowHeaders number[] to string[] if needed
  const processedRowHeaders: boolean | string[] | ((index: number) => string) | undefined = 
    Array.isArray(rowHeaders) && rowHeaders.length > 0 && typeof rowHeaders[0] === 'number'
      ? rowHeaders.map(String)
      : (rowHeaders as boolean | string[] | undefined)

  const settings: Handsontable.GridSettings = {
    ...(omitDataAndColumnsFromReactSettings
      ? {}
      : {
          data: dataForSettingsRef.current,
          columns: processedColumns,
        }),
    colHeaders,
    rowHeaders: processedRowHeaders,
    width,
    height: height === 'auto' ? undefined : height,
    stretchH,
    licenseKey: 'non-commercial-and-evaluation',
    readOnly,
    // Include formulas in initial config when enableFormula so Formulas plugin always has a string sheetName (avoids HyperFormula error)
    ...(enableFormula && hyperformulaInstance
      ? { formulas: { engine: hyperformulaInstance, sheetName: 'Sheet1' } }
      : {}),
    // Enable borders for cells
    renderAllRows: false,
    // Ensure Handsontable recognizes all rows for virtual scrolling
    minSpareRows: 0,
    // Default row height; can still grow when Handsontable sets larger height (e.g. dropdown/select)
    rowHeights: 24,
    outsideClickDeselects: true,
    
    // Keyboard shortcuts configuration
    // Arrow Keys - Move between cells (default behavior)
    navigableHeaders: true,
    tabNavigation: true,
    
    // Enter - Edit cell (default behavior)
    // Tab - Next cell (default behavior)
    // Shift+Arrow - Select range (default behavior)
    
    // Enable copy/paste (Ctrl+C / Ctrl+V)
    copyPaste: {
      pasteMode: 'overwrite', // Overwrite cells instead of shifting them down
      rowsLimit: 10000,
      columnsLimit: 1000,
      uiContainer: document.body,
    },
    
    // Enable undo/redo (Ctrl+Z / Ctrl+Y)
    undo: true,
    
    // Delete key - Clear cell content
    // (default behavior when cell is selected)
    
    // Cell context menu: optional native row ops + Highlight / See comment / Add comment
    contextMenu: (() => {
      const cellMenuCustom = Boolean(onCellHighlight || onCellSeeComment || onCellAddComment)
      const cellMenuCallback = (key: string, selection: number[][] | undefined) => {
        const hot = hotTableRef.current?.hotInstance as any
        let row: number
        let col: number
        const range = selection?.[0]
        if (range && range.length >= 2) {
          row = range[0]
          col = range[1]
        } else if (hot?.getSelectedLast?.()) {
          const sel = hot.getSelectedLast()
          row = sel[0]
          col = sel[1]
        } else {
          return
        }
        if (key === 'highlight' && onCellHighlight) onCellHighlight(row, col)
        if (key === 'see_comment' && onCellSeeComment) onCellSeeComment(row, col)
        if (key === 'add_comment') {
          const hasComment = getCellHasComment?.(row, col)
          if (hasComment && onCellRemoveComment) onCellRemoveComment(row, col)
          else if (!hasComment && onCellAddComment) onCellAddComment(row, col)
        }
      }
      const cellOnlyItems = {
        ...(onCellHighlight
          ? {
              highlight: {
                name: function (this: any) {
                  const sel = this.getSelectedLast?.()
                  if (!sel || !getCellIsHighlighted) return 'Highlight'
                  return getCellIsHighlighted(sel[0], sel[1]) ? 'Remove highlight' : 'Highlight'
                },
              },
            }
          : {}),
        ...(onCellSeeComment
          ? {
              sep_cell: '---------',
              see_comment: { name: 'See comment' },
            }
          : onCellAddComment
            ? {
                sep_cell: '---------',
                add_comment: {
                  name: function (this: any) {
                    const sel = this.getSelectedLast?.()
                    if (!sel || !getCellHasComment) return 'Add comment'
                    return getCellHasComment(sel[0], sel[1]) ? 'Remove comment' : 'Add comment'
                  },
                },
              }
            : {}),
      }
      const nativeRowAndEditItems = {
        row_above: {},
        row_below: {},
        remove_row: {},
        sep_nr0: '---------',
        copy: {},
        cut: {},
        sep_nr1: '---------',
        undo: {},
        redo: {},
        sep_nr2: '---------',
      }
      if (cellMenuCustom && contextMenuWithNativeRows) {
        return {
          callback: cellMenuCallback,
          items: {
            ...nativeRowAndEditItems,
            ...cellOnlyItems,
          },
        }
      }
      if (cellMenuCustom) {
        return {
          callback: cellMenuCallback,
          items: cellOnlyItems,
        }
      }
      if (onContextMenu) return undefined
      return [
        'row_above',
        'row_below',
        'remove_row',
        '---------',
        'col_left',
        'col_right',
        'remove_col',
        '---------',
        'copy',
        'cut',
        '---------',
        'undo',
        'redo',
      ] as any
    })(),
    
    // Manual column resize
    manualColumnResize: true,
    manualRowResize: true,
    
    // Column sorting: use prop (default false to preserve table order)
    columnSorting: columnSortingProp,

    // Auto column width
    autoColumnSize: {
      syncLimit: 50,
    },
    
    // Cell selection
    selectionMode: 'multiple',
    
    // Before change: allow parent to correct changes (e.g. fix fill copying wrong column)
    beforeChange: (changes, source) => {
      if (beforeChangeCorrect && changes) {
        const hot = hotTableRef.current?.hotInstance ?? null
        const valid = changes.filter((c): c is NonNullable<typeof c> => c != null)
        const result = beforeChangeCorrect(valid, source, hot)
        if (result === false) return false
      }
    },
    
    // After change callback
    afterChange: (changes, source) => {
      // Skip individual callbacks during batch operations (like Ctrl+D fill down)
      if (isBatchOperationRef.current && String(source) === 'CopyDown') {
        return
      }
      // When user commits an edit, clear formula ref highlight so dotted line is removed
      if (enableFormula && String(source) === 'edit') {
        setFormulaRefRanges([])
        const hot = hotTableRef.current?.hotInstance as Handsontable | undefined
        if (hot?.rootElement) {
          hot.rootElement.querySelectorAll('.formula-ref-highlight').forEach((el) => {
            el.classList.remove('formula-ref-highlight')
          })
        }
      }
      if (afterChange && changes) {
        afterChange(changes, source)
      }
    },
    
    // After selection callback (also open dropdown on single-cell selection when selection was from mouse)
    afterSelection: (r, c, r2, c2) => {
      if (afterSelection) {
        afterSelection(r, c, r2, c2)
      }
      const hot = hotTableRef.current?.hotInstance as any
      if (hot && selectionFromMouseRef.current && r === r2 && c === c2) {
        selectionFromMouseRef.current = false
        try {
          const cellProperties = hot.getCellMeta(r, c)
          const isDropdown =
            cellProperties &&
            (cellProperties.type === 'dropdown' || cellProperties.editor === 'select' || (cellProperties as any).selectOptions)
          if (isDropdown && !hot.isEditing()) {
            // Open editor via EditorManager (same path as Enter key); editor isn't created until we trigger open
            setTimeout(() => {
              try {
                if (hot.isDestroyed) return
                const editorManager = hot._getEditorManager?.()
                if (editorManager?.openEditor) {
                  editorManager.openEditor(null, null, true)
                }
              } catch {
                // ignore
              }
            }, 0)
          }
        } catch {
          // ignore
        }
      }
    },

    afterDeselect() {
      if (afterDeselect) afterDeselect()
    },

    // Formula reference highlighting + force dropdown list to open on single click
    afterBeginEditing(row: number, col: number) {
      const hot = hotTableRef.current?.hotInstance as any
      if (!hot) return
      // 1) Formula ref highlighting when enableFormula
      if (enableFormula) {
        const prev = formulaEditorInputRef.current
        if (prev) {
          prev.el.removeEventListener('input', prev.listener)
          formulaEditorInputRef.current = null
        }
        const val = hot.getSourceDataAtCell?.(row, col) ?? hot.getDataAtCell(row, col)
        const formula = typeof val === 'string' ? val : ''
        if (formula.startsWith('=')) {
          setFormulaRefRanges(parseFormulaReferences(formula))
        } else {
          setFormulaRefRanges([])
        }
        setTimeout(() => {
          const root = hot.rootElement
          const input = root?.querySelector('.handsontableInput') as HTMLInputElement | HTMLTextAreaElement | null
          if (input) {
            const listener = () => {
              const value = input.value
              if (typeof value === 'string' && value.startsWith('=')) {
                setFormulaRefRanges(parseFormulaReferences(value))
              } else {
                setFormulaRefRanges([])
              }
            }
            input.addEventListener('input', listener)
            formulaEditorInputRef.current = { el: input, listener }
          }
        }, 0)
      }
      // 2) Force dropdown/autocomplete list to open so single-click shows options (must run after editor's open() finishes)
      const editorManager = hot._getEditorManager?.()
      const editor = editorManager?.activeEditor
      if (editor && typeof editor.queryChoices === 'function') {
        const runQuery = () => {
          try {
            if (hot.isDestroyed) return
            const ed = editorManager?.activeEditor
            if (!ed || typeof ed.queryChoices !== 'function') return
            const val = ed.TEXTAREA != null ? (ed.TEXTAREA as HTMLInputElement).value : ''
            ed.queryChoices(val ?? '')
          } catch {
            // ignore
          }
        }
        setTimeout(runQuery, 20)
        setTimeout(runQuery, 80)
      }
    },
    ...(enableFormula
      ? {
          afterFinishEditing() {
            const ref = formulaEditorInputRef.current
            if (ref) {
              ref.el.removeEventListener('input', ref.listener)
              formulaEditorInputRef.current = null
            }
            setFormulaRefRanges([])
            // Remove dotted highlight from DOM immediately (grid may not re-apply cells callback right away)
            const hot = hotTableRef.current?.hotInstance as Handsontable | undefined
            if (hot?.rootElement) {
              hot.rootElement.querySelectorAll('.formula-ref-highlight').forEach((el) => {
                el.classList.remove('formula-ref-highlight')
              })
            }
          },
        }
      : {}),

    // Custom cell renderer (merge formula-ref highlight when enableFormula)
    cells:
      enableFormula && formulaRefRanges.length > 0
        ? (row: number, col: number) => {
            const base = cells?.(row, col) ?? {}
            const inRange = formulaRefRanges.some(
              (r) => row >= r.startRow && row <= r.endRow && col >= r.startCol && col <= r.endCol
            )
            if (inRange) {
              return {
                ...base,
                className: (base.className ? base.className + ' ' : '') + 'formula-ref-highlight',
              }
            }
            return base
          }
        : cells || undefined,
    
    // Custom header renderer for colored headers - removed as it's not a valid Handsontable setting
    // Header styling is handled via CSS and custom header rendering in individual tabs
    
    // Styling
    className,
    
    // Prevent text selection during navigation
    preventOverflow: 'horizontal',
    
    // Enable fill handle for drag-fill
    fillHandle: {
      direction: 'vertical',
      autoInsertRow: true,
    },
    // Drag row by row header to reorder
    manualRowMove: true,
    afterRowMove: (movedRows, finalIndex) => {
      if (onAfterRowMove) onAfterRowMove(movedRows, finalIndex)
    },
    ...(afterCreateRow ? { afterCreateRow } : {}),
    ...(afterRemoveRow ? { afterRemoveRow } : {}),
    ...(onAfterUndoRedoSync
      ? {
          afterUndo: () => runUndoRedoSyncFromParent(),
          afterRedo: () => runUndoRedoSyncFromParent(),
        }
      : {}),

    // Custom keyboard shortcuts
    customBorders: true,
    
    // Enable search
    search: true,
    
    // Enable filters
    dropdownMenu: false,
    
    // Enable comments
    comments: false,

    // Sync row heights from main table to row header clone; apply cell styles/titles so highlights persist after scroll
    afterRender: function (this: Handsontable) {
      syncRowHeaderHeightsToClone(this)
      syncColHeaderHeightForProviders(this)
      applyCellStylesAndTitles(this, getCellTitle)
      afterRenderCallback?.(this)
    },
    afterScrollVertically: function (this: Handsontable) {
      syncRowHeaderHeightsToClone(this)
      applyCellStylesAndTitles(this, getCellTitle)
    },
    afterScrollHorizontally: function (this: Handsontable) {
      applyCellStylesAndTitles(this, getCellTitle)
    },
    afterColumnResize: function (this: Handsontable) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => syncColHeaderHeightForProviders(this))
      })
    },
    ...(afterGetColHeader
      ? {
          afterGetColHeader(_col: number, TH: HTMLTableCellElement, headerLevel?: number) {
            decorateColHeaderRef.current?.(_col, TH, headerLevel)
          },
        }
      : {}),
  }
  
  // Add Ctrl+D (or Cmd+D on Mac) keyboard shortcut for fill down
  useEffect(() => {
    if (!hotTableRef.current?.hotInstance) return
    
    const hotInstance = hotTableRef.current.hotInstance
    const rootElement = hotInstance.rootElement
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+D (Windows/Linux) or Cmd+D (Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        event.preventDefault()
        event.stopPropagation()
        
        const selected = hotInstance.getSelected()
        if (!selected || selected.length === 0) return
        // Get the first selection range
        let [startRow, startCol, endRow, endCol] = selected[0]
        
        // Normalize selection: ensure startRow <= endRow and startCol <= endCol
        // (selection can be in reverse order when dragging left or up)
        if (startRow > endRow) {
          [startRow, endRow] = [endRow, startRow]
        }
        if (startCol > endCol) {
          [startCol, endCol] = [endCol, startCol]
        }
        
        // Fill down: each cell gets the value from the cell directly above it
        // Process each column independently
        const changes: Handsontable.CellChange[] = []
        // Collect all changes first, then apply them in a batch
        for (let col = startCol; col <= endCol; col++) {
          // For each column, fill down from top to bottom

          for (let row = startRow; row <= endRow; row++) {
            // Get the value from the cell directly above (row - 1)
            const sourceRow = row - 1
            if (sourceRow < 0) continue // Skip if we're at the top row
            
            const sourceValue = hotInstance.getDataAtCell(sourceRow, col)
            const oldValue = hotInstance.getDataAtCell(row, col)
            
            // Only set if there's a value to copy
            if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
              changes.push([row, col, oldValue, sourceValue])
            }
          }
        }
        // Apply all changes in a single batch to prevent flickering
        if (changes.length > 0) {
          // Set flag to prevent individual afterChange callbacks during batch
          isBatchOperationRef.current = true
          
          // Suspend rendering to batch all updates
          hotInstance.suspendRender()
          try {
            // Apply all changes
            for (const [row, col, _oldValue, newValue] of changes) {
              // Use 'CopyDown' as source to identify this operation
              hotInstance.setDataAtCell(row, col, newValue, 'CopyDown' as Handsontable.ChangeSource)
            }
          } finally {
            hotInstance.resumeRender()
            // Reset flag after render completes
            isBatchOperationRef.current = false
          }
          
          // Use requestAnimationFrame to ensure DOM is fully updated before triggering callback
          // This prevents the flickering where values appear, disappear, then reappear
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // Double RAF ensures the render is complete and parent state updates won't cause flicker
              if (afterChange) {
                afterChange(changes, 'CopyDown' as Handsontable.ChangeSource)
              }
            })
          })
        }
      }
    }
    
    rootElement.addEventListener('keydown', handleKeyDown)
    
    return () => {
      rootElement.removeEventListener('keydown', handleKeyDown)
    }
  }, [afterChange])

  // Single-click on bubble: select cell, open editor, and open native <select> dropdown immediately
  useEffect(() => {
    if (!hotTableRef.current?.hotInstance) return
    const hotInstance = hotTableRef.current.hotInstance as any

    const handleCellMouseDown = (event: MouseEvent) => {
      // Ignore our own simulated mousedown (dispatched on the <select> to open dropdown); they have isTrusted: false
      if (!event.isTrusted) return
      const target = event.target as HTMLElement
      const bubble = target.closest('.handsontable-bubble-select')
      const cell = target.closest('td')
      // No cell when click is on the opened Select editor (it's outside the table); that's the normal "second click" to open the options list
      if (!cell) return
      if (cell.closest('thead') || cell.closest('.ht_clone_top') || cell.closest('.ht_clone_left')) return
      if (!cell.closest('.ht_master')) return

      // Treat any click inside a dropdown cell (bubble or arrow) as opening the dropdown
      const cellHasBubble = cell.querySelector('.handsontable-bubble-select')
      if (!bubble && !cellHasBubble) {
        selectionFromMouseRef.current = true
        return
      }

      let row: number | null = null
      let col: number | null = null
      try {
        const coords = hotInstance.getCoords(cell)
        if (coords) {
          if (Array.isArray(coords) && coords.length >= 2) {
            row = coords[0]
            col = coords[1]
          } else if (typeof coords === 'object' && 'row' in coords && 'col' in coords) {
            row = (coords as { row: number; col: number }).row
            col = (coords as { row: number; col: number }).col
          }
        }
      } catch {
        const rowElement = cell.closest('tr')
        if (rowElement?.parentElement) {
          const tbody = rowElement.parentElement
          const rowIndex = Array.from(tbody.children).indexOf(rowElement)
          const cellIndex = Array.from(rowElement.cells).indexOf(cell as HTMLTableCellElement)
          if (rowIndex >= 0 && cellIndex >= 0) {
            const hasRowHeaders = hotInstance.getSettings().rowHeaders
            row = hasRowHeaders ? rowIndex : rowIndex
            col = hasRowHeaders ? cellIndex - 1 : cellIndex
          }
        }
      }
      if (row === null || col === null || row < 0 || col < 0) return

      try {
        const cellProperties = hotInstance.getCellMeta(row, col)
        const isDropdown =
          cellProperties &&
          (cellProperties.type === 'dropdown' || cellProperties.editor === 'select' || (cellProperties as any).selectOptions)
        const isEditing = typeof hotInstance.isEditing === 'function' ? hotInstance.isEditing() : false
        if (!isDropdown || isEditing) return
      } catch {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      hotInstance.selectCell(row, col)

      const openEditorAndDropdown = () => {
        try {
          if (hotInstance.isDestroyed) return
          const editorManager = hotInstance._getEditorManager?.()
          if (!editorManager?.openEditor) return
          editorManager.openEditor(null, null, true)
          // Dropdown (autocomplete) editor shows its list in open() via queryChoices. Select editor's native list cannot be opened programmatically in most browsers.
        } catch {
          // ignore
        }
      }
      setTimeout(openEditorAndDropdown, 0)
    }

    const rootElement = hotInstance.rootElement
    rootElement.addEventListener('mousedown', handleCellMouseDown, true)
    return () => rootElement.removeEventListener('mousedown', handleCellMouseDown, true)
  }, [])

  // Handle context menu: only when right-clicking on the row header (number row), not on the sheet (data cells)
  useEffect(() => {
    if (hotTableRef.current && onContextMenu) {
      const hotInstance = hotTableRef.current.hotInstance
      if (hotInstance) {
        const handleContextMenu = (event: MouseEvent) => {
          const target = event.target as HTMLElement
          const rowHeaderCell = target.closest('.ht_clone_left th')
          if (!rowHeaderCell) return
          const tr = rowHeaderCell.closest('tr')
          if (!tr?.parentElement) return
          const tbody = tr.parentElement
          const domOffset = Array.from(tbody.children).indexOf(tr as Element)
          if (domOffset < 0) return
          const mapper = hotInstance.rowIndexMapper
          let rowIndex: number | null
          const firstRenderedVisual = hotInstance.getFirstRenderedVisibleRow?.() ?? null
          if (firstRenderedVisual != null && mapper?.getRenderableFromVisualIndex && mapper?.getPhysicalFromRenderableIndex) {
            const firstRenderedRenderable = mapper.getRenderableFromVisualIndex(firstRenderedVisual)
            const clickedRenderable = firstRenderedRenderable + domOffset
            rowIndex = mapper.getPhysicalFromRenderableIndex(clickedRenderable)
          } else {
            rowIndex = mapper?.getPhysicalFromRenderableIndex(domOffset) ?? domOffset
          }
          if (rowIndex == null || rowIndex < 0) return
          event.preventDefault()
          event.stopPropagation()
          onContextMenu(rowIndex, 0, event)
        }
        
        const element = hotInstance.rootElement
        element.addEventListener('contextmenu', handleContextMenu, true)
        
        return () => {
          element.removeEventListener('contextmenu', handleContextMenu, true)
        }
      }
    }
  }, [onContextMenu])

  // Round horizontal scroll to whole pixels so column header clone stays aligned with body (no text shift)
  useEffect(() => {
    if (!hotTableRef.current?.hotInstance) return
    const hotInstance = hotTableRef.current.hotInstance
    const holder = hotInstance.rootElement?.querySelector('.ht_master .wtHolder') as HTMLElement | null
    if (!holder) return
    let rafId = 0
    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const left = holder.scrollLeft
        const rounded = Math.round(left)
        if (rounded !== left) holder.scrollLeft = rounded
      })
    }
    holder.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      holder.removeEventListener('scroll', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  // Sync row header column heights to match data rows (after render and when data changes)
  useEffect(() => {
    const hot = hotTableRef.current?.hotInstance
    if (!hot?.rootElement) return
    const run = () => syncRowHeaderHeightsToClone(hot)
    run()
    const t1 = requestAnimationFrame(run)
    const t2 = setTimeout(run, 100)
    return () => {
      cancelAnimationFrame(t1)
      clearTimeout(t2)
    }
  }, [data.length, dataVersion])

  // Providers tab: keep row-number corner height in sync with column header row when it wraps (ResizeObserver)
  useEffect(() => {
    let cancelled = false
    let disconnect: (() => void) | null = null
    const rafId = requestAnimationFrame(() => {
      const hot = hotTableRef.current?.hotInstance
      if (!hot?.rootElement || cancelled) return
      const container = hot.rootElement.closest?.('.providers-handsontable') as HTMLElement | null
      if (!container) return
      const headerRow =
        (hot.rootElement.querySelector('.ht_clone_top table.htCore thead tr') as HTMLTableRowElement | null) ||
        (hot.rootElement.querySelector('.ht_master table.htCore thead tr') as HTMLTableRowElement | null)
      if (!headerRow) return
      const sync = () => syncColHeaderHeightForProviders(hot)
      sync()
      const ro = new ResizeObserver(() => {
        if (!cancelled) requestAnimationFrame(sync)
      })
      ro.observe(headerRow)
      disconnect = () => ro.disconnect()
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      disconnect?.()
    }
  }, [dataVersion, data.length])

  // Re-render grid when formula ref ranges change so dotted highlight is applied/cleared
  useEffect(() => {
    const hot = hotTableRef.current?.hotInstance
    if (hot && typeof hot.render === 'function') {
      hot.render()
    }
  }, [formulaRefRanges])

  return (
    <div style={style} className={className}>
      <style>{`
        .formula-ref-highlight {
          outline: 2px dotted #2563eb !important;
          outline-offset: -1px;
          z-index: 1;
        }
      `}</style>
      <HotTable
        ref={hotTableRef}
        settings={settings}
      />
    </div>
  )
}
