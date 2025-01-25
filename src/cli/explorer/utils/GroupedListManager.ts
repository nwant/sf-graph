/**
 * Grouped List Manager
 * 
 * Shared utility for managing collapsible groups in blessed list widgets.
 * Used by RelationshipBrowser and ObjectView for consistent group behavior.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListElement = any;

export interface GroupedItem {
  isHeader: boolean;
  groupIndex: number;
}

export interface GroupedListConfig {
  /** The blessed list widget */
  list: ListElement;
  /** Function to get current items array */
  getItems: () => GroupedItem[];
  /** Function to get group header indices */
  getGroupHeaderIndices: () => number[];
  /** Function called when rebuild is needed (e.g., after collapse/expand) */
  onRebuild: () => void;
  /** Function to get total number of possible groups (can change dynamically) */
  getTotalGroups: () => number;
}

export class GroupedListManager {
  private collapsedGroups: Set<number> = new Set();
  private config: GroupedListConfig;

  constructor(config: GroupedListConfig) {
    this.config = config;
  }

  /**
   * Check if a group is collapsed.
   */
  isCollapsed(groupIndex: number): boolean {
    return this.collapsedGroups.has(groupIndex);
  }

  /**
   * Get the set of collapsed group indices.
   */
  getCollapsedGroups(): Set<number> {
    return this.collapsedGroups;
  }

  /**
   * Clear all collapsed state (e.g., when switching data).
   */
  clearCollapsed(): void {
    this.collapsedGroups.clear();
  }

  /**
   * Get current group index from list selection.
   */
  getCurrentGroupIndex(): number | null {
    const currentIndex = this.config.list.selected || 0;
    const items = this.config.getItems();
    const item = items[currentIndex];
    return item?.groupIndex ?? null;
  }

  /**
   * Collapse the group under cursor.
   */
  collapseCurrentGroup(): boolean {
    const groupIndex = this.getCurrentGroupIndex();
    if (groupIndex !== null && !this.collapsedGroups.has(groupIndex)) {
      this.collapsedGroups.add(groupIndex);
      this.rebuildAndRender();
      return true;
    }
    return false;
  }

  /**
   * Expand the group under cursor.
   */
  expandCurrentGroup(): boolean {
    const groupIndex = this.getCurrentGroupIndex();
    if (groupIndex !== null && this.collapsedGroups.has(groupIndex)) {
      this.collapsedGroups.delete(groupIndex);
      this.rebuildAndRender();
      return true;
    }
    return false;
  }

  /**
   * Toggle expand/collapse for group under cursor.
   */
  toggleCurrentGroup(): boolean {
    const groupIndex = this.getCurrentGroupIndex();
    if (groupIndex !== null) {
      if (this.collapsedGroups.has(groupIndex)) {
        this.collapsedGroups.delete(groupIndex);
      } else {
        this.collapsedGroups.add(groupIndex);
      }
      this.rebuildAndRender();
      return true;
    }
    return false;
  }

  /**
   * Expand all groups.
   */
  expandAllGroups(): boolean {
    if (this.collapsedGroups.size > 0) {
      this.collapsedGroups.clear();
      this.rebuildAndRender();
      return true;
    }
    return false;
  }

  /**
   * Collapse all groups.
   */
  collapseAllGroups(): boolean {
    const totalGroups = this.config.getTotalGroups();
    if (this.collapsedGroups.size < totalGroups) {
      for (let i = 0; i < totalGroups; i++) {
        this.collapsedGroups.add(i);
      }
      this.rebuildAndRender();
      return true;
    }
    return false;
  }

  /**
   * Jump to next group header.
   */
  jumpToNextGroup(): void {
    const headerIndices = this.config.getGroupHeaderIndices();
    if (headerIndices.length === 0) return;

    const currentIndex = this.config.list.selected || 0;
    const items = this.config.getItems();

    // Find the next group header after current position
    let nextHeaderIndex = headerIndices.find(i => i > currentIndex);

    // If none found, wrap to first group header
    if (nextHeaderIndex === undefined) {
      nextHeaderIndex = headerIndices[0];
    }

    // Select first item after header (not the header itself)
    const firstItemIndex = nextHeaderIndex + 1;
    if (firstItemIndex < items.length && !items[firstItemIndex].isHeader) {
      this.config.list.select(firstItemIndex);
    } else {
      this.config.list.select(nextHeaderIndex);
    }
    // Scroll to ensure header is visible
    this.config.list.scrollTo(nextHeaderIndex);
  }

  /**
   * Skip headers during navigation.
   */
  skipHeaders(direction: 'up' | 'down'): void {
    const index = this.config.list.selected || 0;
    const items = this.config.getItems();
    const item = items[index];

    if (item && item.isHeader) {
      if (direction === 'down' && index < items.length - 1) {
        this.config.list.down(1);
      } else if (direction === 'up' && index > 0) {
        this.config.list.up(1);
      }
    }
  }

  /**
   * Select first item after first header and scroll to top.
   */
  selectFirstAndScrollToTop(): void {
    const items = this.config.getItems();
    if (items.length > 1) {
      this.config.list.select(1);
      this.config.list.scrollTo(0);
    } else if (items.length > 0) {
      this.config.list.select(0);
    }
  }

  /**
   * Rebuild and render, preserving group position.
   */
  private rebuildAndRender(): void {
    const previousGroupIndex = this.getCurrentGroupIndex();

    this.config.onRebuild();

    // Find the header for the group we were in
    const items = this.config.getItems();
    if (previousGroupIndex !== null) {
      const headerIndex = items.findIndex(
        item => item.isHeader && item.groupIndex === previousGroupIndex
      );

      if (headerIndex >= 0) {
        const firstItemIndex = headerIndex + 1;
        if (firstItemIndex < items.length && !items[firstItemIndex].isHeader) {
          this.config.list.select(firstItemIndex);
        } else {
          this.config.list.select(headerIndex);
        }
        this.config.list.scrollTo(headerIndex);
      }
    } else {
      this.config.list.select(0);
    }
  }
}
