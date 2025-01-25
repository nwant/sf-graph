/**
 * Relationship Browser Component
 *
 * Unified tree view with collapsible PARENTS and CHILDREN groups.
 * Uses GroupedListManager for collapse/expand behavior.
 * Implements FilterableView for shared filter operations.
 */

import { styles, layout, symbols, colors } from '../theme.js';
import type { ObjectDetails, ObjectRelationship } from '../../../core/types.js';
import type { AggregatedRelationship } from '../types.js';
import type { FilterableView } from '../types/FilterableView.js';
import { GroupedListManager, GroupedItem } from '../utils/GroupedListManager.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

interface RelationshipItem extends GroupedItem {
  relationship: AggregatedRelationship | null;
  headerText?: string;
}

export class RelationshipBrowser implements FilterableView {
  public element: BoxElement;

  private relationshipList: ListElement;
  private groupManager: GroupedListManager;

  private parentItems: AggregatedRelationship[] = [];
  private childItems: AggregatedRelationship[] = [];
  private items: RelationshipItem[] = [];
  private groupHeaderIndices: number[] = [];

  private filterText = '';

  constructor(blessed: Blessed, parent: Screen) {
    // Main container (below shared header)
    this.element = blessed.box({
      parent,
      top: 3,
      left: 0,
      width: layout.leftPaneWidth,
      height: '100%-4',
      border: layout.border,
      style: styles.box.default,
      tags: true,
      label: ' Relationships ',
    });

    // Unified relationship list
    this.relationshipList = blessed.list({
      parent: this.element,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
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

    // Initialize group manager
    this.groupManager = new GroupedListManager({
      list: this.relationshipList,
      getItems: () => this.items,
      getGroupHeaderIndices: () => this.groupHeaderIndices,
      onRebuild: () => {
        this.buildItemList();
        this.render();
      },
      getTotalGroups: () => 2,  // PARENTS and CHILDREN
    });
  }

  /**
   * Update the browser with a new object's data.
   */
  setObject(object: ObjectDetails): void {
    // Clear collapsed state when switching objects
    this.groupManager.clearCollapsed();
    
    // Aggregate relationships
    this.parentItems = this.aggregateRelationships(object.relationships, 'outgoing');
    this.childItems = this.aggregateRelationships(object.relationships, 'incoming');

    this.buildItemList();
    this.render();
    this.groupManager.selectFirstAndScrollToTop();
  }

  /**
   * Move selection up (with cycling).
   */
  moveUp(): void {
    const currentIndex = this.relationshipList.selected || 0;
    
    if (currentIndex <= 0 && this.items.length > 0) {
      this.relationshipList.select(this.items.length - 1);
    } else {
      this.relationshipList.up(1);
    }
    this.groupManager.skipHeaders('up');
    this.relationshipList.screen.render();
  }

  /**
   * Move selection down (with cycling).
   */
  moveDown(): void {
    const currentIndex = this.relationshipList.selected || 0;
    
    if (currentIndex >= this.items.length - 1 && this.items.length > 0) {
      this.relationshipList.select(0);
    } else {
      this.relationshipList.down(1);
    }
    this.groupManager.skipHeaders('down');
    this.relationshipList.screen.render();
  }

  /**
   * Get the currently selected relationship, or null if on header.
   */
  getSelectedRelationship(): AggregatedRelationship | null {
    const selectedIndex = this.relationshipList.selected || 0;
    const item = this.items[selectedIndex];
    if (item && !item.isHeader) {
      return item.relationship;
    }
    return null;
  }

  // Delegate group operations to manager
  jumpToNextGroup(): void {
    this.groupManager.jumpToNextGroup();
    this.relationshipList.screen.render();
  }

  collapseCurrentGroup(): void {
    this.groupManager.collapseCurrentGroup();
  }

  expandCurrentGroup(): void {
    this.groupManager.expandCurrentGroup();
  }

  toggleCurrentGroup(): void {
    this.groupManager.toggleCurrentGroup();
  }

  expandAllGroups(): void {
    this.groupManager.expandAllGroups();
  }

  collapseAllGroups(): void {
    this.groupManager.collapseAllGroups();
  }

  hasGroups(): boolean {
    return this.groupHeaderIndices.length > 0;
  }

  /**
   * Set filter text.
   */
  setFilter(text: string): void {
    this.filterText = text.toLowerCase();
    this.buildItemList();
    this.render();
    
    if (this.filterText && this.items.length > 0) {
      const nonHeaderItems = this.items.filter(item => !item.isHeader && item.relationship);
      if (nonHeaderItems.length > 0) {
        const bestMatch = this.findBestMatch(nonHeaderItems);
        const index = this.items.indexOf(bestMatch);
        if (index >= 0) {
          this.relationshipList.select(index);
          // Let blessed handle scroll - select() will bring item into view
        }
      }
    } else if (!this.filterText) {
      this.groupManager.selectFirstAndScrollToTop();
    }
  }

  /**
   * Clear filter.
   */
  clearFilter(): void {
    this.filterText = '';
    this.buildItemList();
    this.render();
    this.groupManager.selectFirstAndScrollToTop();
  }

  /**
   * Check if filter is active.
   */
  hasFilter(): boolean {
    return this.filterText.length > 0;
  }

  /**
   * Focus the list widget.
   */
  focus(): void {
    this.relationshipList.focus();
  }

  private buildItemList(): void {
    this.items = [];
    this.groupHeaderIndices = [];

    const filteredParents = this.applyFilter(this.parentItems);
    const filteredChildren = this.applyFilter(this.childItems);
    const collapsedGroups = this.groupManager.getCollapsedGroups();

    // Build PARENTS group
    const parentCount = filteredParents.length;
    const totalParents = this.parentItems.length;
    const isParentsCollapsed = collapsedGroups.has(0);
    const parentIndicator = isParentsCollapsed ? '►' : '▼';
    const parentLabel = this.filterText
      ? `${parentIndicator} PARENTS (${parentCount}/${totalParents})`
      : `${parentIndicator} PARENTS (${totalParents})`;

    this.groupHeaderIndices.push(this.items.length);
    this.items.push({
      relationship: null,
      isHeader: true,
      headerText: parentLabel,
      groupIndex: 0,
    });

    if (!isParentsCollapsed) {
      filteredParents.forEach(rel => {
        this.items.push({
          relationship: rel,
          isHeader: false,
          groupIndex: 0,
        });
      });
    }

    // Build CHILDREN group
    const childCount = filteredChildren.length;
    const totalChildren = this.childItems.length;
    const isChildrenCollapsed = collapsedGroups.has(1);
    const childIndicator = isChildrenCollapsed ? '►' : '▼';
    const childLabel = this.filterText
      ? `${childIndicator} CHILDREN (${childCount}/${totalChildren})`
      : `${childIndicator} CHILDREN (${totalChildren})`;

    this.groupHeaderIndices.push(this.items.length);
    this.items.push({
      relationship: null,
      isHeader: true,
      headerText: childLabel,
      groupIndex: 1,
    });

    if (!isChildrenCollapsed) {
      filteredChildren.forEach(rel => {
        this.items.push({
          relationship: rel,
          isHeader: false,
          groupIndex: 1,
        });
      });
    }
  }

  private applyFilter(items: AggregatedRelationship[]): AggregatedRelationship[] {
    if (!this.filterText) return items;
    return items.filter(
      (item) =>
        item.relatedObject.toLowerCase().includes(this.filterText) ||
        item.fields.some((f) => f.toLowerCase().includes(this.filterText))
    );
  }

  private findBestMatch(items: RelationshipItem[]): RelationshipItem {
    const lowerFilter = this.filterText.toLowerCase();
    let bestItem = items[0];
    let bestScore = -1;

    items.forEach((item) => {
      if (!item.relationship) return;
      const name = item.relationship.relatedObject.toLowerCase();
      let score = 0;

      if (name === lowerFilter) {
        score = 1000;
      } else if (name.startsWith(lowerFilter)) {
        score = 500 - name.length;
      } else if (name.includes(lowerFilter)) {
        score = 100 - name.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    });

    return bestItem;
  }

  private aggregateRelationships(
    relationships: ObjectRelationship[],
    direction: 'outgoing' | 'incoming'
  ): AggregatedRelationship[] {
    const filtered = relationships.filter((r) => r.direction === direction);
    const map = new Map<string, AggregatedRelationship>();

    filtered.forEach((r) => {
      const key = r.relatedObject;
      if (!map.has(key)) {
        map.set(key, {
          relatedObject: r.relatedObject,
          direction,
          fields: [],
          fieldLabels: new Map(),
          fieldDescriptions: new Map(),
          relationshipTypes: new Set(),
          isMasterDetail: false,
          isPolymorphic: false,
        });
      }
      const agg = map.get(key)!;
      agg.fields.push(r.fieldApiName);
      if (r.fieldLabel) {
        agg.fieldLabels.set(r.fieldApiName, r.fieldLabel);
      }
      if (r.fieldDescription) {
        agg.fieldDescriptions.set(r.fieldApiName, r.fieldDescription);
      }
      agg.relationshipTypes.add(r.relationshipType);
      if (r.relationshipType === 'MasterDetail') {
        agg.isMasterDetail = true;
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.relatedObject.localeCompare(b.relatedObject)
    );
  }

  private render(): void {
    const labels = this.items.map((item) => {
      if (item.isHeader) {
        return `{${colors.fg.muted}-fg}${item.headerText}{/}`;
      }
      return this.formatItemLabel(item.relationship!);
    });

    this.relationshipList.setItems(labels);

    const total = this.parentItems.length + this.childItems.length;
    this.element.setLabel(` Relationships (${total}) `);
  }

  private formatItemLabel(item: AggregatedRelationship): string {
    let label = `  ${item.relatedObject}`;

    if (item.fields.length > 0) {
      const fieldName = item.fields[0];
      label += ` (${fieldName})`;
    }

    const indicators: string[] = [];
    if (item.isMasterDetail) {
      indicators.push(symbols.masterDetail);
    }
    if (item.isPolymorphic) {
      indicators.push(symbols.polymorphic);
    }
    if (indicators.length > 0) {
      label += ` ${indicators.join(' ')}`;
    }

    return label;
  }
}
