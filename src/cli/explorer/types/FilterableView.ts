/**
 * FilterableView Interface
 * 
 * Common interface for views that support filtering.
 * Implemented by RelationshipBrowser and ObjectView.
 */

export interface FilterableView {
  /**
   * Apply filter text to the view.
   */
  setFilter(text: string): void;

  /**
   * Clear any active filter.
   */
  clearFilter(): void;

  /**
   * Check if filter is active.
   */
  hasFilter(): boolean;

  /**
   * Move selection up.
   */
  moveUp(): void;

  /**
   * Move selection down.
   */
  moveDown(): void;
}
