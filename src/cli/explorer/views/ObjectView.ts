/**
 * Object View
 *
 * Split-pane view for browsing object fields.
 * Left pane: Field list with sections (standard/custom)
 * Right pane: Field details for selected field
 * Implements FilterableView for shared filter operations.
 */

import { layout, colors } from '../theme.js';
import type { ObjectDetails, SalesforceField } from '../../../core/types.js';
import type { FilterableView } from '../types/FilterableView.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

interface FieldItem {
  field: SalesforceField;
  isHeader: boolean;
  headerText?: string;
  groupIndex?: number;  // For tab navigation between groups
}

type GroupMode = 'flat' | 'type' | 'origin' | 'required';

const GROUP_MODES: GroupMode[] = ['flat', 'type', 'origin', 'required'];
const GROUP_LABELS: Record<GroupMode, string> = {
  flat: 'A-Z',
  type: 'by type',
  origin: 'std/custom',
  required: 'required first',
};

export class ObjectView implements FilterableView {
  public container: BoxElement;
  public fieldList: ListElement;
  public detailPane: BoxElement;

  private currentObject: ObjectDetails | null = null;
  private items: FieldItem[] = [];
  private filterText = '';
  private groupMode: GroupMode = 'flat';
  private groupHeaderIndices: number[] = [];  // Indices of group headers for tab navigation
  private collapsedGroups: Set<number> = new Set();  // Collapsed group indices
  private groupNames: string[] = [];  // Names of groups for display

  constructor(blessed: Blessed, parent: Screen) {
    // Main container (below shared header)
    this.container = blessed.box({
      parent,
      top: 3,
      left: 0,
      width: '100%',
      height: '100%-4',
      hidden: true,
    });

    // Left pane: Field list
    this.fieldList = blessed.list({
      parent: this.container,
      top: 0,
      left: 0,
      width: layout.leftPaneWidth,
      height: '100%',
      label: ' Fields ',
      tags: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      border: { type: 'line' },
      scrollbar: {
        ch: ' ',
        track: { bg: colors.bg.secondary },
        style: { inverse: true },
      },
      style: {
        fg: colors.fg.primary,
        bg: colors.bg.primary,
        border: { fg: colors.fg.accent },
        selected: {
          fg: colors.fg.accent,
          bg: colors.bg.secondary,
          bold: true,
        },
        item: {
          fg: colors.fg.primary,
        },
      },
    });

    // Right pane: Field details
    this.detailPane = blessed.box({
      parent: this.container,
      top: 0,
      right: 0,
      width: layout.rightPaneWidth,
      height: '100%',
      label: ' Field Details ',
      tags: true,
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: { bg: colors.bg.secondary },
        style: { inverse: true },
      },
      style: {
        fg: colors.fg.primary,
        bg: colors.bg.primary,
        border: { fg: colors.border.normal },
      },
    });
  }

  /**
   * Show the object view with field data.
   */
  show(object: ObjectDetails): void {
    this.currentObject = object;
    this.buildFieldList();
    this.render();
    this.container.show();
    this.fieldList.focus();
    this.fieldList.select(0);
    this.updateDetailPane();
  }

  /**
   * Hide the view.
   */
  hide(): void {
    this.container.hide();
    this.currentObject = null;
    this.items = [];
  }

  /**
   * Check if visible.
   */
  isVisible(): boolean {
    return this.container.visible;
  }

  /**
   * Move selection up (with cycling).
   */
  moveUp(): void {
    const currentIndex = this.fieldList.selected || 0;
    if (currentIndex <= 0 && this.items.length > 0) {
      this.fieldList.select(this.items.length - 1);
    } else {
      this.fieldList.up(1);
    }
    this.skipHeaders('up');
    this.updateDetailPane();
  }

  /**
   * Move selection down (with cycling).
   */
  moveDown(): void {
    const currentIndex = this.fieldList.selected || 0;
    if (currentIndex >= this.items.length - 1 && this.items.length > 0) {
      this.fieldList.select(0);
    } else {
      this.fieldList.down(1);
    }
    this.skipHeaders('down');
    this.updateDetailPane();
  }

  /**
   * Get selected field or null.
   */
  getSelectedField(): SalesforceField | null {
    const index = this.fieldList.selected || 0;
    const item = this.items[index];
    if (item && !item.isHeader) {
      return item.field;
    }
    return null;
  }

  /**
   * Get reference target (if selected field is a lookup).
   */
  getReferenceTo(): string | null {
    const field = this.getSelectedField();
    if (field && field.referenceTo && field.referenceTo.length > 0) {
      return field.referenceTo[0];
    }
    return null;
  }

  /**
   * Get field API name for copying.
   */
  getFieldApiName(): string | null {
    const field = this.getSelectedField();
    return field?.apiName ?? null;
  }

  /**
   * Set filter text.
   */
  setFilter(text: string): void {
    this.filterText = text.toLowerCase();
    this.buildFieldList();
    this.render();
    this.fieldList.select(0);
    this.skipHeaders('down');
    this.updateDetailPane();
  }

  /**
   * Clear filter.
   */
  clearFilter(): void {
    this.filterText = '';
    this.buildFieldList();
    this.render();
  }

  /**
   * Check if filter is active.
   */
  hasFilter(): boolean {
    return this.filterText.length > 0;
  }

  /**
   * Cycle to next grouping mode.
   */
  cycleGroupMode(): void {
    const currentIndex = GROUP_MODES.indexOf(this.groupMode);
    const nextIndex = (currentIndex + 1) % GROUP_MODES.length;
    this.groupMode = GROUP_MODES[nextIndex];
    this.buildFieldList();
    this.render();
    
    // For grouped modes with headers, stay on header so it's visible
    // For flat mode, just go to first item
    if (this.groupMode === 'flat') {
      this.fieldList.select(0);
    } else if (this.groupHeaderIndices.length > 0) {
      this.fieldList.select(0);  // Select header
      // Move down to first field item so it's selected for details
      this.fieldList.down(1);
      // Scroll up to ensure header is visible
      this.fieldList.scrollTo(0);
    }
    this.updateDetailPane();
  }

  /**
   * Jump to next group header (for tab navigation).
   */
  jumpToNextGroup(): void {
    if (this.groupHeaderIndices.length === 0) return;
    
    const currentIndex = this.fieldList.selected || 0;
    
    // Find the next group header after current position
    let nextHeaderIndex = this.groupHeaderIndices.find(i => i > currentIndex);
    
    // If none found, wrap to first group header
    if (nextHeaderIndex === undefined) {
      nextHeaderIndex = this.groupHeaderIndices[0];
    }
    
    // Select the first field after the header (not the header itself)
    const firstFieldIndex = nextHeaderIndex + 1;
    if (firstFieldIndex < this.items.length) {
      this.fieldList.select(firstFieldIndex);
      // Scroll so header is visible (scroll to header position)
      this.fieldList.scrollTo(nextHeaderIndex);
    } else {
      this.fieldList.select(nextHeaderIndex);
    }
    this.updateDetailPane();
  }

  /**
   * Get current grouping mode label for display.
   */
  getGroupModeLabel(): string {
    return GROUP_LABELS[this.groupMode];
  }

  /**
   * Check if currently in a grouped mode (not flat).
   */
  isGrouped(): boolean {
    return this.groupMode !== 'flat';
  }

  /**
   * Get the group index for the current selection.
   */
  private getCurrentGroupIndex(): number | null {
    const currentIndex = this.fieldList.selected || 0;
    const item = this.items[currentIndex];
    if (item?.groupIndex !== undefined) {
      return item.groupIndex;
    }
    return null;
  }

  /**
   * Collapse the group under cursor.
   */
  collapseCurrentGroup(): void {
    const groupIndex = this.getCurrentGroupIndex();
    if (groupIndex !== null && !this.collapsedGroups.has(groupIndex)) {
      this.collapsedGroups.add(groupIndex);
      this.rebuildAndRender();
    }
  }

  /**
   * Expand the group under cursor.
   */
  expandCurrentGroup(): void {
    const groupIndex = this.getCurrentGroupIndex();
    if (groupIndex !== null && this.collapsedGroups.has(groupIndex)) {
      this.collapsedGroups.delete(groupIndex);
      this.rebuildAndRender();
    }
  }

  /**
   * Toggle expand/collapse for group under cursor.
   */
  toggleCurrentGroup(): void {
    const groupIndex = this.getCurrentGroupIndex();
    if (groupIndex !== null) {
      if (this.collapsedGroups.has(groupIndex)) {
        this.collapsedGroups.delete(groupIndex);
      } else {
        this.collapsedGroups.add(groupIndex);
      }
      this.rebuildAndRender();
    }
  }

  /**
   * Expand all groups.
   */
  expandAllGroups(): void {
    if (this.collapsedGroups.size > 0) {
      this.collapsedGroups.clear();
      this.rebuildAndRender();
    }
  }

  /**
   * Collapse all groups.
   */
  collapseAllGroups(): void {
    const totalGroups = this.groupNames.length;
    if (this.collapsedGroups.size < totalGroups) {
      for (let i = 0; i < totalGroups; i++) {
        this.collapsedGroups.add(i);
      }
      this.rebuildAndRender();
    }
  }

  /**
   * Rebuild field list and render, preserving scroll position.
   */
  private rebuildAndRender(): void {
    // Remember which group we were in
    const previousGroupIndex = this.getCurrentGroupIndex();
    
    this.buildFieldList();
    this.render();
    
    // Find the header for the group we were in, then select first field after it
    if (previousGroupIndex !== null) {
      // Find the header index for this group
      const headerIndex = this.items.findIndex(
        item => item.isHeader && item.groupIndex === previousGroupIndex
      );
      
      if (headerIndex >= 0) {
        // Select first field after header (or header if no fields)
        const firstFieldIndex = headerIndex + 1;
        if (firstFieldIndex < this.items.length && !this.items[firstFieldIndex].isHeader) {
          this.fieldList.select(firstFieldIndex);
        } else {
          this.fieldList.select(headerIndex);
        }
        // Scroll so header is visible
        this.fieldList.scrollTo(headerIndex);
      }
    } else {
      this.fieldList.select(0);
    }
    this.updateDetailPane();
  }

  private buildFieldList(): void {
    if (!this.currentObject) {
      this.items = [];
      this.groupHeaderIndices = [];
      return;
    }

    const fields = this.currentObject.fields;
    const filtered = this.filterText
      ? fields.filter(
          (f) =>
            f.apiName.toLowerCase().includes(this.filterText) ||
            f.label.toLowerCase().includes(this.filterText)
        )
      : fields;

    this.items = [];
    this.groupHeaderIndices = [];
    this.groupNames = [];

    switch (this.groupMode) {
      case 'flat':
        this.buildFlatList(filtered);
        break;
      case 'type':
        this.buildByTypeList(filtered);
        break;
      case 'origin':
        this.buildByOriginList(filtered);
        break;
      case 'required':
        this.buildRequiredFirstList(filtered);
        break;
    }
  }

  private buildFlatList(fields: SalesforceField[]): void {
    const sorted = [...fields].sort((a, b) => a.apiName.localeCompare(b.apiName));
    sorted.forEach((f) => this.items.push({ field: f, isHeader: false }));
  }

  private buildByTypeList(fields: SalesforceField[]): void {
    const categories: Record<string, SalesforceField[]> = {
      'Relationships': [],
      'Formulas': [],
      'Picklists': [],
      'Text': [],
      'Number': [],
      'Date/Time': [],
      'Other': [],
    };

    // Categorize fields
    fields.forEach((f) => {
      const type = f.type.toLowerCase();
      if (type === 'reference') {
        categories['Relationships'].push(f);
      } else if (type.includes('formula') || type.includes('rollup')) {
        categories['Formulas'].push(f);
      } else if (type.includes('picklist')) {
        categories['Picklists'].push(f);
      } else if (['string', 'textarea', 'url', 'email', 'phone', 'encryptedstring'].includes(type)) {
        categories['Text'].push(f);
      } else if (['int', 'double', 'currency', 'percent'].includes(type)) {
        categories['Number'].push(f);
      } else if (['date', 'datetime', 'time'].includes(type)) {
        categories['Date/Time'].push(f);
      } else {
        categories['Other'].push(f);
      }
    });

    // Build items with headers
    let groupIndex = 0;
    for (const [category, catFields] of Object.entries(categories)) {
      if (catFields.length === 0) continue;
      
      this.groupNames.push(category);
      const isCollapsed = this.collapsedGroups.has(groupIndex);
      const indicator = isCollapsed ? '►' : '▼';
      
      this.groupHeaderIndices.push(this.items.length);
      this.items.push({
        field: catFields[0],
        isHeader: true,
        headerText: `${indicator} ${category} (${catFields.length})`,
        groupIndex,
      });
      
      // Only add fields if not collapsed
      if (!isCollapsed) {
        catFields.sort((a, b) => a.apiName.localeCompare(b.apiName));
        catFields.forEach((f) => this.items.push({ field: f, isHeader: false, groupIndex }));
      }
      groupIndex++;
    }
  }

  private buildByOriginList(fields: SalesforceField[]): void {
    const standard = fields.filter((f) => f.category === 'standard');
    const custom = fields.filter((f) => f.category === 'custom');

    // Always show Standard group (index 0)
    this.groupNames.push('Standard');
    const isStandardCollapsed = this.collapsedGroups.has(0);
    const standardIndicator = isStandardCollapsed ? '►' : '▼';
    
    this.groupHeaderIndices.push(this.items.length);
    this.items.push({
      field: standard[0] || custom[0] || fields[0],  // Fallback for header field
      isHeader: true,
      headerText: `${standardIndicator} Standard (${standard.length})`,
      groupIndex: 0,
    });
    if (!isStandardCollapsed && standard.length > 0) {
      standard.sort((a, b) => a.apiName.localeCompare(b.apiName));
      standard.forEach((f) => this.items.push({ field: f, isHeader: false, groupIndex: 0 }));
    }

    // Always show Custom group (index 1)
    this.groupNames.push('Custom');
    const isCustomCollapsed = this.collapsedGroups.has(1);
    const customIndicator = isCustomCollapsed ? '►' : '▼';
    
    this.groupHeaderIndices.push(this.items.length);
    this.items.push({
      field: custom[0] || standard[0] || fields[0],  // Fallback for header field
      isHeader: true,
      headerText: `${customIndicator} Custom (${custom.length})`,
      groupIndex: 1,
    });
    if (!isCustomCollapsed && custom.length > 0) {
      custom.sort((a, b) => a.apiName.localeCompare(b.apiName));
      custom.forEach((f) => this.items.push({ field: f, isHeader: false, groupIndex: 1 }));
    }
  }

  private buildRequiredFirstList(fields: SalesforceField[]): void {
    const required = fields.filter((f) => f.required);
    const optional = fields.filter((f) => !f.required);

    // Always show Required group (index 0)
    this.groupNames.push('Required');
    const isRequiredCollapsed = this.collapsedGroups.has(0);
    const requiredIndicator = isRequiredCollapsed ? '►' : '▼';
    
    this.groupHeaderIndices.push(this.items.length);
    this.items.push({
      field: required[0] || optional[0] || fields[0],  // Fallback for header field
      isHeader: true,
      headerText: `${requiredIndicator} Required (${required.length})`,
      groupIndex: 0,
    });
    if (!isRequiredCollapsed && required.length > 0) {
      required.sort((a, b) => a.apiName.localeCompare(b.apiName));
      required.forEach((f) => this.items.push({ field: f, isHeader: false, groupIndex: 0 }));
    }

    // Always show Optional group (index 1)
    this.groupNames.push('Optional');
    const isOptionalCollapsed = this.collapsedGroups.has(1);
    const optionalIndicator = isOptionalCollapsed ? '►' : '▼';
    
    this.groupHeaderIndices.push(this.items.length);
    this.items.push({
      field: optional[0] || required[0] || fields[0],  // Fallback for header field
      isHeader: true,
      headerText: `${optionalIndicator} Optional (${optional.length})`,
      groupIndex: 1,
    });
    if (!isOptionalCollapsed && optional.length > 0) {
      optional.sort((a, b) => a.apiName.localeCompare(b.apiName));
      optional.forEach((f) => this.items.push({ field: f, isHeader: false, groupIndex: 1 }));
    }
  }

  private render(): void {
    const labels = this.items.map((item) => {
      if (item.isHeader) {
        return `{${colors.fg.muted}-fg}${item.headerText}{/}`;
      }
      return this.formatFieldLabel(item.field);
    });

    this.fieldList.setItems(labels);

    // Update label with count and grouping mode
    const total = this.currentObject?.fields.length ?? 0;
    const customCount =
      this.currentObject?.fields.filter((f) => f.category === 'custom').length ?? 0;
    const modeLabel = GROUP_LABELS[this.groupMode];
    this.fieldList.setLabel(` Fields: ${total} (${customCount} custom) [${modeLabel}] `);
  }

  private formatFieldLabel(field: SalesforceField): string {
    const name = this.truncate(field.apiName, 18);
    const typeAbbr = this.getTypeAbbreviation(field.type);
    const flags = this.getFieldFlags(field);

    return `  ${name.padEnd(20)} ${typeAbbr.padEnd(5)} ${flags}`;
  }

  private getTypeAbbreviation(type: string): string {
    const abbrevMap: Record<string, string> = {
      string: 'Text',
      textarea: 'TxtA',
      boolean: 'Bool',
      currency: 'Curr',
      date: 'Date',
      datetime: 'DtTm',
      double: 'Num',
      int: 'Int',
      email: 'Email',
      id: 'ID',
      lookup: 'Look',
      masterdetail: 'M-D',
      percent: 'Pct',
      phone: 'Phone',
      picklist: 'Pick',
      multipicklist: 'MPck',
      reference: 'Look',
      url: 'URL',
      encryptedstring: 'Encr',
      address: 'Addr',
      location: 'Loc',
      time: 'Time',
      formula: 'Form',
      rollup: 'Roll',
    };

    const lower = type.toLowerCase();
    return abbrevMap[lower] || type.substring(0, 4);
  }

  private getFieldFlags(field: SalesforceField): string {
    const flags: string[] = [];

    if (field.required) {
      flags.push('[r]');
    }

    // Check for formula/rollup in type
    const lowerType = field.type.toLowerCase();
    if (lowerType.includes('formula')) {
      flags.push('(f)');
    } else if (lowerType.includes('rollup') || lowerType.includes('summary')) {
      flags.push('[Σ]');
    }

    return flags.join(' ');
  }

  private skipHeaders(direction: 'up' | 'down'): void {
    const index = this.fieldList.selected || 0;
    const item = this.items[index];

    if (item && item.isHeader) {
      if (direction === 'down' && index < this.items.length - 1) {
        this.fieldList.down(1);
      } else if (direction === 'up' && index > 0) {
        this.fieldList.up(1);
      }
    }
  }

  private updateDetailPane(): void {
    const field = this.getSelectedField();
    if (!field) {
      this.detailPane.setContent('');
      this.detailPane.setLabel(' Field Details ');
      return;
    }

    this.detailPane.setLabel(` ${field.apiName} `);
    const lines: string[] = [''];

    this.addDetailLine(lines, 'Label', field.label);
    this.addDetailLine(lines, 'API Name', field.apiName);
    this.addDetailLine(lines, 'Type', field.type);

    if (field.referenceTo && field.referenceTo.length > 0) {
      this.addDetailLine(lines, 'References', field.referenceTo.join(', '));
    }

    lines.push('');
    this.addDetailLine(lines, 'Required', field.required ? 'true' : 'false');
    this.addDetailLine(lines, 'Unique', field.unique ? 'true' : 'false');
    this.addDetailLine(lines, 'External ID', field.externalId ? 'true' : 'false');

    if (field.namespace) {
      lines.push('');
      this.addDetailLine(lines, 'Namespace', field.namespace);
    }

    this.detailPane.setContent(lines.join('\n'));
  }

  private addDetailLine(lines: string[], label: string, value: string): void {
    const paddedLabel = label.padEnd(14);
    lines.push(`{${colors.fg.muted}-fg}${paddedLabel}{/}${value}`);
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }
}
