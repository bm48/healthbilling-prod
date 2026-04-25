import Handsontable from 'handsontable'
import { formatDateOfServiceAsYouType, toDisplayDate } from '@/lib/utils'

/**
 * Renders a numeric value as currency ($10.00). Empty/null shows blank.
 * Sets explicit text color so cells are readable in dark-theme containers (e.g. Providers tab).
 */
export function currencyCellRenderer(
  _instance: any,
  td: HTMLElement,
  _row: number,
  _col: number,
  _prop: string | number,
  value: any,
  cellProperties: any
) {
  const textRenderer = Handsontable.renderers.TextRenderer
  let display = ''
  if (value !== null && value !== undefined && value !== '' && value !== 'null') {
    const num = typeof value === 'number' ? value : parseFloat(String(value))
    if (!isNaN(num)) {
      display = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
    }
  }
  textRenderer(_instance, td as HTMLTableCellElement, _row, _col, _prop, display, cellProperties)
  td.style.color = '#111827'
}

/**
 * Renders a numeric value as percentage (10%). Empty/null shows blank.
 * Sets explicit text color so cells are readable in dark-theme containers (e.g. Providers tab).
 */
export function percentCellRenderer(
  _instance: any,
  td: HTMLElement,
  _row: number,
  _col: number,
  _prop: string | number,
  value: any,
  cellProperties: any
) {
  const textRenderer = Handsontable.renderers.TextRenderer
  let display = ''
  if (value !== null && value !== undefined && value !== '' && value !== 'null') {
    const num = typeof value === 'number' ? value : parseFloat(String(value))
    if (!isNaN(num)) {
      display = `${num}%`
    }
  }
  textRenderer(_instance, td as HTMLTableCellElement, _row, _col, _prop, display, cellProperties)
  td.style.color = '#111827'
}

/**
 * Co-pay as text: if value is numeric show as currency; otherwise show as plain text (e.g. N/A, TBD).
 */
export function copayTextCellRenderer(
  _instance: any,
  td: HTMLElement,
  _row: number,
  _col: number,
  _prop: string | number,
  value: any,
  cellProperties: any
) {
  const textRenderer = Handsontable.renderers.TextRenderer
  let display = ''
  if (value !== null && value !== undefined && value !== '' && value !== 'null') {
    const str = String(value).trim()
    const num = parseFloat(str)
    if (str !== '' && !Number.isNaN(num)) {
      display = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
    } else {
      display = str
    }
  }
  textRenderer(_instance, td as HTMLTableCellElement, _row, _col, _prop, display, cellProperties)
  td.style.color = '#111827'
}

/**
 * Co-insurance as text: if value is numeric show as percentage; otherwise show as plain text (e.g. N/A, TBD).
 */
export function coinsuranceTextCellRenderer(
  _instance: any,
  td: HTMLElement,
  _row: number,
  _col: number,
  _prop: string | number,
  value: any,
  cellProperties: any
) {
  const textRenderer = Handsontable.renderers.TextRenderer
  let display = ''
  if (value !== null && value !== undefined && value !== '' && value !== 'null') {
    const str = String(value).trim()
    const num = parseFloat(str)
    if (str !== '' && !Number.isNaN(num)) {
      display = `${num}%`
    } else {
      display = str
    }
  }
  textRenderer(_instance, td as HTMLTableCellElement, _row, _col, _prop, display, cellProperties)
  td.style.color = '#111827'
}

/**
 * Custom renderer for dropdown cells with background colors (full cell fill)
 */
export function createColoredDropdownRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    _instance: any,
    td: HTMLElement,
    _row: number,
    _col: number,
    _prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    const colorConfig = value ? colorMap(String(value)) : null
    if (colorConfig) {
      td.style.backgroundColor = colorConfig.color
      td.style.color = colorConfig.textColor
      td.style.fontWeight = '500'
    } else {
      td.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
      td.style.color = '#000000'
      td.style.fontWeight = 'normal'
    }
    
    textRenderer(_instance, td as HTMLTableCellElement, _row, _col, _prop, value || '', cellProperties)
  }
}

/**
 * Custom renderer for dropdown cells with bubble/pill style (doesn't fill entire cell)
 */
export function createBubbleDropdownRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    _instance: any,
    td: HTMLElement,
    _row: number,
    _col: number,
    _prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Clear any existing content
    td.innerHTML = ''
    
    // Reset cell styles
    td.style.backgroundColor = ''
    td.style.color = ''
    td.style.fontWeight = ''
    td.style.padding = '2px 4px'
    td.style.textAlign = 'left'
    td.style.verticalAlign = 'middle'
    td.style.position = 'relative'
    
    const displayValue = value ? String(value) : ''
    const colorConfig = displayValue ? colorMap(displayValue) : null

    // Wrapper: flex row so bubble can shrink and icon always has space to its right
    const wrapper = document.createElement('div')
    wrapper.style.display = 'flex'
    wrapper.style.alignItems = 'center'
    wrapper.style.width = '100%'
    wrapper.style.gap = '8px'
    wrapper.style.minWidth = '0'

    // Create bubble element (flex: 1 so it shrinks; icon keeps reserved space)
    const bubble = document.createElement('span')
    bubble.className = 'handsontable-bubble-select'

    const textSpan = document.createElement('span')
    textSpan.textContent = displayValue
    textSpan.style.overflow = 'hidden'
    textSpan.style.textOverflow = 'ellipsis'
    textSpan.style.whiteSpace = 'nowrap'

    // Down arrow icon – always show so user knows it's a select column (even when empty)
    const arrowIcon = document.createElement('span')
    arrowIcon.innerHTML = '▼'
    arrowIcon.style.fontSize = '10px'
    arrowIcon.style.opacity = '0.7'
    arrowIcon.style.verticalAlign = 'middle'
    arrowIcon.style.flexShrink = '0'

    bubble.appendChild(textSpan)
    wrapper.appendChild(bubble)
    wrapper.appendChild(arrowIcon)

    // Bubble styles – flex: 1 minWidth: 0 so it can shrink and ellipsis when needed
    bubble.style.display = 'inline-flex'
    bubble.style.alignItems = 'center'
    bubble.style.flex = '1'
    bubble.style.minWidth = '0'
    bubble.style.padding = '4px 12px'
    bubble.style.borderRadius = '16px'
    bubble.style.fontSize = '13px'
    bubble.style.fontWeight = '500'
    bubble.style.lineHeight = '1.4'
    bubble.style.whiteSpace = 'nowrap'
    bubble.style.overflow = 'hidden'
    bubble.style.textOverflow = 'ellipsis'
    bubble.style.cursor = cellProperties.readOnly ? 'default' : 'pointer'

    // Apply colors from colorMap (empty uses default gray)
    if (colorConfig) {
      bubble.style.backgroundColor = colorConfig.color
      bubble.style.color = colorConfig.textColor
      arrowIcon.style.color = colorConfig.color
    } else {
      bubble.style.backgroundColor = '#ddd'
      bubble.style.color = '#374151'
      arrowIcon.style.color = '#374151'
      bubble.style.height = '24px'
    }

    td.appendChild(wrapper)
  }
}

/**
 * Multi-bubble renderer for comma-separated values (e.g. multi-select CPT codes).
 * Renders each value as its own bubble/pill.
 */
export function createMultiBubbleDropdownRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    _instance: any,
    td: HTMLElement,
    _row: number,
    _col: number,
    _prop: string | number,
    value: any,
    cellProperties: any
  ) {
    td.innerHTML = ''
    td.style.backgroundColor = ''
    td.style.color = ''
    td.style.fontWeight = ''
    td.style.padding = '2px 4px'
    td.style.textAlign = 'left'
    td.style.verticalAlign = 'middle'
    td.style.paddingRight = '10px'
    td.style.position = 'relative'

    const raw = value ? String(value) : ''
    const parts = raw ? raw.split(',').map((s: string) => s.trim()).filter(Boolean) : []

    const wrapper = document.createElement('div')
    wrapper.style.display = 'flex'
    wrapper.style.flexWrap = 'nowrap'
    wrapper.style.overflow = 'hidden'
    wrapper.style.gap = '6px'
    wrapper.style.alignItems = 'center'
    wrapper.style.minHeight = '100%'
    wrapper.style.position = 'relative'
    wrapper.style.marginRight = '15px'

    if (parts.length > 0) {
      parts.forEach((code: string) => {
        const colorConfig = colorMap(code)
        const bubble = document.createElement('span')
        bubble.className = 'handsontable-bubble-select'
        bubble.textContent = code
        bubble.style.display = 'inline-flex'
        bubble.style.alignItems = 'center'
        bubble.style.justifyContent = 'center'
        bubble.style.padding = '4px 10px'
        bubble.style.borderRadius = '16px'
        bubble.style.fontSize = '13px'
        bubble.style.fontWeight = '500'
        bubble.style.lineHeight = '1.4'
        bubble.style.whiteSpace = 'nowrap'
        bubble.style.overflow = 'hidden'
        bubble.style.textOverflow = 'ellipsis'
        bubble.style.minWidth = '52px'
        bubble.style.maxWidth = '52px'
        bubble.style.textAlign = 'center'
        bubble.style.cursor = cellProperties.readOnly ? 'default' : 'pointer'
        if (colorConfig) {
          bubble.style.backgroundColor = colorConfig.color
          bubble.style.color = colorConfig.textColor
        } else {
          bubble.style.backgroundColor = '#e5e7eb'
          bubble.style.color = '#374151'
        }
        wrapper.appendChild(bubble)
      })
    } else {
      // Empty cell: show one empty bubble like other select cells
      const bubble = document.createElement('span')
      bubble.className = 'handsontable-bubble-select'
      bubble.style.display = 'inline-flex'
      bubble.style.alignItems = 'center'
      bubble.style.flex = '1'
      bubble.style.minWidth = '0'
      bubble.style.padding = '4px 12px'
      bubble.style.borderRadius = '16px'
      bubble.style.fontSize = '13px'
      bubble.style.fontWeight = '500'
      bubble.style.lineHeight = '1.4'
      bubble.style.minHeight = '24px'
      bubble.style.cursor = cellProperties.readOnly ? 'default' : 'pointer'
      bubble.style.backgroundColor = '#ddd'
      bubble.style.color = '#374151'
      wrapper.appendChild(bubble)
    }

    // Arrow icon – always show so user knows it's a select column (even when empty)
    const arrow = document.createElement('span')
    arrow.innerHTML = '▼'
    arrow.style.fontSize = '10px'
    arrow.style.opacity = '0.7'
    arrow.style.marginLeft = '2px'
    arrow.style.position = 'absolute'
    arrow.style.right = '4px'
    arrow.style.top = '50%'
    arrow.style.zIndex = '1001'
    arrow.style.transform = 'translateY(-50%)'
    td.appendChild(arrow)
    td.appendChild(wrapper)
  }
}

const _BaseDropdown =
  (Handsontable as any).editors?.DropdownEditor ?? (Handsontable as any).editors?.AutocompleteEditor

/**
 * Dropdown editor that forces the options list to open when the editor opens.
 * The default AutocompleteEditor uses _registerTimeout for queryChoices, which can fail to show
 * the list when the editor is opened programmatically (e.g. single-click on bubble). This subclass
 * calls queryChoices after open() so the list always appears.
 */
export const DropdownEditorOpenList: typeof _BaseDropdown | null = _BaseDropdown
  ? class DropdownEditorOpenList extends _BaseDropdown {
      open(event?: Event) {
        super.open(event)
        if (typeof (this as any).queryChoices === 'function') {
          const val = (this as any).TEXTAREA?.value ?? ''
          setTimeout(() => {
            try {
              if (typeof (this as any).queryChoices === 'function') (this as any).queryChoices(val)
            } catch {
              // ignore
            }
          }, 0)
        }
      }
    }
  : null

/**
 * Custom date editor using HTML5 date input
 */
export class DateEditor extends Handsontable.editors.TextEditor {
  createElements() {
    super.createElements()
    
    // Replace the textarea with a date input
    if (this.TEXTAREA && this.TEXTAREA.tagName === 'TEXTAREA') {
      const dateInput = document.createElement('input')
      dateInput.setAttribute('type', 'date')
      dateInput.setAttribute('data-hot-input', 'true')
      dateInput.className = this.TEXTAREA.className
      
      // Copy styles from textarea
      const textareaStyle = window.getComputedStyle(this.TEXTAREA)
      dateInput.style.cssText = textareaStyle.cssText
      
      // Replace textarea with date input
      if (this.TEXTAREA.parentNode) {
        this.TEXTAREA.parentNode.replaceChild(dateInput, this.TEXTAREA)
      }
      this.TEXTAREA = dateInput
    } else if (this.TEXTAREA && this.TEXTAREA.tagName === 'INPUT') {
      // If it's already an input, just change the type
      (this.TEXTAREA as HTMLInputElement).setAttribute('type', 'date')
    }
  }
  
  /** Normalize a date string to YYYY-MM-DD for the HTML5 date input; return empty if invalid. */
  private normalizeDateForInput(raw: string): string {
    if (!raw || !raw.trim()) return ''
    let normalized = raw.trim()
    const mmddyy = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/.exec(normalized)
    if (mmddyy) {
      const month = parseInt(mmddyy[1], 10)
      const day = parseInt(mmddyy[2], 10)
      const y = parseInt(mmddyy[3], 10)
      const year = y < 100 ? 2000 + y : y
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        normalized = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      }
    }
    try {
      const date = new Date(normalized)
      if (!isNaN(date.getTime())) {
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
    } catch {
      if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
    }
    return ''
  }

  beginEditing(initialValue?: string) {
    super.beginEditing(initialValue)
    this.populateDateFromCell(initialValue)
  }

  open(event?: Event) {
    super.open(event)
    // Base editor only sets value in full edit mode; on double-click the input can be empty. Set it from cell here.
    this.populateDateFromCell(undefined)
  }

  /** Set the date input value from initialValue or from the cell's current value (originalValue / getDataAtCell). */
  private populateDateFromCell(initialValue?: string) {
    if (!this.TEXTAREA) return
    const inputElement = this.TEXTAREA as HTMLInputElement
    let raw = ''
    if (initialValue != null && initialValue !== '') {
      raw = String(initialValue)
    } else if (inputElement.value) {
      return // already set (e.g. by base in full edit mode)
    } else {
      const ed = this as any
      let v = ed.originalValue
      if (v == null || v === undefined) {
        try {
          v = ed.hot?.getSourceDataAtCell?.(ed.row, ed.col) ?? ed.hot?.getDataAtCell?.(ed.row, ed.col)
        } catch {
          v = ed.hot?.getDataAtCell?.(ed.row, ed.col)
        }
      }
      if (v != null && v !== undefined) raw = String(v)
      else {
        const getter = ed.cellProperties?.valueGetter
        if (getter && ed.originalValue !== undefined) v = getter(ed.originalValue)
        if (v != null && v !== undefined) raw = String(v)
      }
    }
    const ymd = this.normalizeDateForInput(raw)
    if (ymd) inputElement.value = ymd
  }
  
  getValue() {
    return (this.TEXTAREA as HTMLInputElement)?.value || ''
  }
  
  setValue(value: string) {
    if (this.TEXTAREA) {
      (this.TEXTAREA as HTMLInputElement).value = value
    }
  }
}

/**
 * Text editor that auto-formats input as MM-DD-YY while typing (digits only, auto-inserts dashes).
 */
export class DateOfServiceEditor extends Handsontable.editors.TextEditor {
  createElements() {
    super.createElements()
    const input = this.TEXTAREA as HTMLInputElement
    if (!input) return
    const formatInput = () => {
      const raw = input.value
      const formatted = formatDateOfServiceAsYouType(raw)
      if (formatted !== raw) {
        input.value = formatted
        input.setSelectionRange(formatted.length, formatted.length)
      }
    }
    input.addEventListener('input', formatInput)
    input.setAttribute('placeholder', 'MM-DD-YY')
  }

  open(event?: Event) {
    super.open(event)
    const input = this.TEXTAREA as HTMLInputElement
    if (!input) return
    const raw = input.value
    if (raw && raw.trim()) return
    const ed = this as any
    let cellValue = ed.originalValue
    if (cellValue == null) {
      try {
        cellValue = ed.hot?.getSourceDataAtCell?.(ed.row, ed.col) ?? ed.hot?.getDataAtCell?.(ed.row, ed.col)
      } catch {
        cellValue = ed.hot?.getDataAtCell?.(ed.row, ed.col)
      }
    }
    const display = toDisplayDate(cellValue != null ? String(cellValue) : '')
    if (display) input.value = display
  }

  beginEditing(initialValue?: string) {
    super.beginEditing(initialValue)
    const input = this.TEXTAREA as HTMLInputElement
    if (!input) return
    const raw = (initialValue != null && initialValue !== '') ? String(initialValue) : input.value
    const display = toDisplayDate(raw)
    if (display) input.value = display
  }
}

/**
 * Custom editor for dropdown cells with colors
 */
export function createColoredDropdownEditor(
  _options: string[],
  colorMap: (value: string) => { color: string; textColor: string } | null
) {
  return class ColoredDropdownEditor extends Handsontable.editors.SelectEditor {
    beginEditing(initialValue?: string) {
      super.beginEditing(initialValue)
      
      const select = (this as any).select as HTMLSelectElement
      if (select) {
        // Style the select element
        const currentValue = select.value
        const colorConfig = currentValue ? colorMap(currentValue) : null
        if (colorConfig) {
          select.style.backgroundColor = colorConfig.color
          select.style.color = colorConfig.textColor
          select.style.fontWeight = '500'
        }
        
        // Style options
        Array.from(select.options).forEach(option => {
          const optionColorConfig = option.value ? colorMap(option.value) : null
          if (optionColorConfig) {
            option.style.backgroundColor = optionColorConfig.color
            option.style.color = optionColorConfig.textColor
            option.style.fontWeight = '500'
          } else {
            option.style.backgroundColor = '#ffffff'
            option.style.color = '#000000'
          }
        })
        
        // Update on change
        select.addEventListener('change', () => {
          const newValue = select.value
          const newColorConfig = newValue ? colorMap(newValue) : null
          if (newColorConfig) {
            select.style.backgroundColor = newColorConfig.color
            select.style.color = newColorConfig.textColor
            select.style.fontWeight = '500'
          } else {
            select.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
            select.style.color = '#000000'
            select.style.fontWeight = 'normal'
          }
        })
      }
    }
  }
}

/**
 * Custom renderer for date cells
 */
export function createDateRenderer() {
  return function(
    instance: any,
    td: HTMLElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    // Format date for display
    const displayValue = value ? String(value) : ''
    textRenderer(instance, td as HTMLTableCellElement, row, col, prop, displayValue, cellProperties)
  }
}

/**
 * Custom renderer for month selector with colors
 */
export function createMonthRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    instance: any,
    td: HTMLElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    const colorConfig = value ? colorMap(String(value)) : null
    if (colorConfig) {
      td.style.backgroundColor = colorConfig.color
      td.style.color = colorConfig.textColor
      td.style.fontWeight = '500'
    } else {
      td.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
      td.style.color = '#000000'
      td.style.fontWeight = 'normal'
    }
    
    textRenderer(instance, td as HTMLTableCellElement, row, col, prop, value || '', cellProperties)
  }
}

/**
 * Multi-select CPT code editor: search at top, list with checkmarks, click to toggle selection.
 * Value stored as comma-separated codes.
 */
export class MultiSelectCptEditor extends Handsontable.editors.BaseEditor {
  private wrapper: HTMLDivElement | null = null
  private searchInput: HTMLInputElement | null = null
  private listEl: HTMLDivElement | null = null
  private selected: Set<string> = new Set()
  private options: string[] = []
  private filteredOptions: string[] = []
  private boundCloseOnClickOutside: (e: MouseEvent) => void = () => {}
  private closeOnClickOutsideTimeoutId: ReturnType<typeof setTimeout> | null = null

  createElements() {
    // BaseEditor has no createElements; we build our own UI
    this.wrapper = document.createElement('div')
    this.wrapper.className = 'handsontable-multiselect-cpt-editor'
    this.wrapper.style.cssText = `
      position: fixed;
      min-width: 200px;
      max-width: 320px;
      max-height: 280px;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #000000;
    `
    this.searchInput = document.createElement('input')
    this.searchInput.type = 'text'
    this.searchInput.placeholder = 'Search...'
    this.searchInput.style.cssText = `
      width: 100%;
      box-sizing: border-box;
      padding: 8px 12px;
      border: none;
      border-bottom: 1px solid #e5e7eb;
      font-size: 14px;
      outline: none;
    `
    this.listEl = document.createElement('div')
    this.listEl.style.cssText = `
      overflow-y: auto;
      max-height: 240px;
      padding: 4px 0;
    `
    this.wrapper.appendChild(this.searchInput)
    this.wrapper.appendChild(this.listEl)
    // Prevent mousedown from bubbling so document listener doesn't close when clicking inside
    this.wrapper.addEventListener('mousedown', (e) => e.stopPropagation())
    ;(this as any).TEXTAREA = this.wrapper
  }

  open() {
    if (!this.wrapper || !this.searchInput || !this.listEl) {
      this.createElements()
    }
    const meta = this.hot.getCellMeta(this.row, this.col)
    const colSettings = (this.hot.getSettings() as any).columns?.[this.col]
    const rawOpts = meta.selectOptions ?? colSettings?.selectOptions
    const resolved = typeof rawOpts === 'function' ? (rawOpts as () => string[])() : rawOpts
    this.options = Array.isArray(resolved)
      ? resolved.map((o: any) => String(o == null ? '' : o))
      : []
    const raw = this.originalValue ?? ''
    this.selected = new Set(raw ? String(raw).split(',').map((s: string) => s.trim()).filter(Boolean) : [])
    this.filteredOptions = [...this.options]
    this.renderList()
    this.positionDropdown()
    this.searchInput!.value = ''
    this.searchInput!.focus()
    this.searchInput!.addEventListener('input', this.onSearch)
    this.searchInput!.addEventListener('keydown', this.onSearchKeydown)
    this.boundCloseOnClickOutside = (e: MouseEvent) => {
      if (this.wrapper && !this.wrapper.contains(e.target as Node)) {
        const hot = (this as any).hot
        if (hot?.isDestroyed) {
          document.removeEventListener('mousedown', this.boundCloseOnClickOutside)
          return
        }
        this.finishEditing()
      }
    }
    if (this.closeOnClickOutsideTimeoutId != null) clearTimeout(this.closeOnClickOutsideTimeoutId)
    this.closeOnClickOutsideTimeoutId = setTimeout(() => {
      this.closeOnClickOutsideTimeoutId = null
      document.addEventListener('mousedown', this.boundCloseOnClickOutside)
    }, 0)
  }

  close() {
    if (this.closeOnClickOutsideTimeoutId != null) {
      clearTimeout(this.closeOnClickOutsideTimeoutId)
      this.closeOnClickOutsideTimeoutId = null
    }
    this.searchInput?.removeEventListener('input', this.onSearch)
    this.searchInput?.removeEventListener('keydown', this.onSearchKeydown)
    document.removeEventListener('mousedown', this.boundCloseOnClickOutside)
    if (this.wrapper?.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper)
    }
    // BaseEditor.close() is abstract; no super call
  }

  private onSearch = () => {
    const q = (this.searchInput!.value || '').trim().toLowerCase()
    this.filteredOptions = q
      ? this.options.filter(opt => opt.toLowerCase().includes(q))
      : [...this.options]
    this.renderList()
  }

  private onSearchKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.cancelChanges()
    }
  }

  private positionDropdown() {
    if (!this.wrapper || !this.TD) return
    const tdRect = this.TD.getBoundingClientRect()
    this.wrapper.style.left = `${tdRect.left}px`
    this.wrapper.style.top = `${tdRect.bottom + 2}px`
    this.wrapper.style.minWidth = `${Math.max(tdRect.width, 200)}px`
    if (!this.wrapper.parentNode) {
      document.body.appendChild(this.wrapper)
    }
  }

  private renderList() {
    if (!this.listEl) return
    this.listEl.innerHTML = ''
    this.filteredOptions.forEach(opt => {
      const row = document.createElement('div')
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 13px;
      `
      row.addEventListener('mouseenter', () => { row.style.backgroundColor = '#f3f4f6' })
      row.addEventListener('mouseleave', () => { row.style.backgroundColor = '' })
      const checked = this.selected.has(opt)
      const check = document.createElement('span')
      check.textContent = checked ? '✓' : ''
      check.style.cssText = `
        width: 18px;
        height: 18px;
        border: 2px solid ${checked ? '#2563eb' : '#9ca3af'};
        border-radius: 4px;
        background: ${checked ? '#2563eb' : 'transparent'};
        color: #fff;
        font-size: 12px;
        font-weight: bold;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      `
      const label = document.createElement('span')
      label.textContent = opt
      row.appendChild(check)
      row.appendChild(label)
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
      row.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (this.selected.has(opt)) {
          this.selected.delete(opt)
        } else {
          this.selected.add(opt)
        }
        this.renderList()
      })
      this.listEl!.appendChild(row)
    })
    if (this.filteredOptions.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'padding: 8px 12px; color: #6b7280; font-size: 13px;'
      empty.textContent = 'No matches'
      this.listEl.appendChild(empty)
    }
  }

  getValue(): string {
    return Array.from(this.selected).join(', ')
  }

  setValue(newValue?: any): void {
    const raw = newValue != null ? String(newValue) : ''
    this.selected = new Set(raw ? raw.split(',').map((s: string) => s.trim()).filter(Boolean) : [])
    if (this.listEl) this.renderList()
  }

  focus() {
    this.searchInput?.focus()
  }
}

/**
 * Custom renderer for CPT code with colors
 */
export function createCPTCodeRenderer(colorMap: (value: string) => { color: string; textColor: string } | null) {
  return function(
    instance: any,
    td: HTMLElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: any
  ) {
    // Use the imported Handsontable directly
    const textRenderer = Handsontable.renderers.TextRenderer
    
    // Handle comma-separated CPT codes - use first one for color
    const primaryCode = value ? String(value).split(',')[0].trim() : ''
    const colorConfig = primaryCode ? colorMap(primaryCode) : null
    if (colorConfig) {
      td.style.backgroundColor = colorConfig.color
      td.style.color = colorConfig.textColor || '#ffffff'
      td.style.fontWeight = '500'
    } else {
      td.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'
      td.style.color = '#000000'
      td.style.fontWeight = 'normal'
    }
    
    textRenderer(instance, td as HTMLTableCellElement, row, col, prop, value || '', cellProperties)
  }
}
