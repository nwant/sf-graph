/**
 * Graph Explorer
 *
 * Main entry point for the neo-blessed interactive graph explorer.
 * Manages screen lifecycle, components, state, and keybindings.
 */

import { exec } from 'child_process';
import { loadBlessed } from './blessed.js';
import { apiService } from '../../core/api-service.js';

import { RelationshipBrowser } from './components/RelationshipBrowser.js';
import { PathPanel } from './components/PathPanel.js';
import { StatusBar } from './components/StatusBar.js';
import { FilterInput } from './components/FilterInput.js';
import { ObjectHeader } from './components/ObjectHeader.js';
import { FieldInspectView } from './views/FieldInspectView.js';
import { ObjectDetailModal } from './views/ObjectDetailModal.js';
import { ObjectView } from './views/ObjectView.js';

import type { ExplorerState, ExplorerOptions, PathNode } from './types.js';
import type { FilterableView } from './types/FilterableView.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;

export class Explorer {
  private screen: Screen;
  private relationshipBrowser: RelationshipBrowser;
  private pathPanel: PathPanel;
  private statusBar: StatusBar;
  private filterInput: FilterInput;
  private objectHeader: ObjectHeader;
  private fieldInspectView: FieldInspectView;
  private objectDetailModal: ObjectDetailModal;
  private objectView: ObjectView;
  private errorBox: BoxElement;

  private state: ExplorerState;
  private orgId?: string;

  private resolveStart?: () => void;

  private constructor(blessed: Blessed, options: ExplorerOptions = {}) {
    this.orgId = options.orgId;

    // Initialize state
    this.state = {
      currentObject: null,
      history: [],
      activeSection: 'parents',
      selectedIndex: 0,
      filterText: '',
      filterActive: false,
      filterSourceView: 'main' as 'main' | 'object-view',
      viewMode: 'main',
      selectedRelationship: null,
      loading: false,
      error: null,
    };

    // Create screen with terminal compatibility options
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Salesforce Graph Explorer',
      fullUnicode: true,
      terminal: 'xterm-256color',
      warnings: false,
    });

    // Create components
    this.objectHeader = new ObjectHeader(blessed, this.screen);
    this.relationshipBrowser = new RelationshipBrowser(blessed, this.screen);
    this.pathPanel = new PathPanel(blessed, this.screen);
    this.statusBar = new StatusBar(blessed, this.screen);
    this.filterInput = new FilterInput(blessed, this.relationshipBrowser.element);
    this.fieldInspectView = new FieldInspectView(blessed, this.screen);
    this.objectDetailModal = new ObjectDetailModal(blessed, this.screen);
    this.objectView = new ObjectView(blessed, this.screen);

    // Error component
    this.errorBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      border: { type: 'line', fg: 'red' },
      style: { 
        fg: 'white', 
        bg: '#2d2d2d',
        border: { fg: 'red' }
      },
      tags: true,
      hidden: true,
      padding: 1,
      label: ' Error '
    });

    // Setup keybindings
    this.setupKeybindings();

    // Setup filter callbacks
    this.setupFilterCallbacks();
  }

  /**
   * Create a new Explorer instance (async factory)
   */
  static async create(options: ExplorerOptions = {}): Promise<Explorer> {
    const blessed = await loadBlessed();
    return new Explorer(blessed, options);
  }

  /**
   * Start the explorer. Returns when the user exits.
   */
  async start(startObject = 'Account'): Promise<void> {
    // Load initial object
    await this.navigateTo(startObject);

    // Render
    this.screen.render();

    // Wait for exit
    return new Promise<void>((resolve) => {
      this.resolveStart = resolve;
    });
  }

  /**
   * Get navigation history.
   */
  getHistory(): PathNode[] {
    return [...this.state.history];
  }

  private setupKeybindings(): void {
    // Exit with q or Ctrl+C
    this.screen.key(['q', 'C-c'], () => {
      this.exit();
    });
    
    // Exit with Escape when in main view (not filtering or in a modal)
    this.screen.key(['escape'], () => {
      if (this.state.error) {
        this.hideError();
      } else if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.exit();
      }
    });

    // Enter to close error OR navigate
    this.screen.key(['enter'], () => {
      if (this.state.error) {
        this.hideError();
        return;
      }
      
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        const selected = this.relationshipBrowser.getSelectedRelationship();
        if (selected) {
          // Get the first field name from the relationship
          const fieldName = selected.fields[0];
          // Use relationship direction: outgoing = lookup to parent, incoming = child referencing us
          const direction = selected.direction === 'outgoing' ? 'parent' : 'child';
          const relType = Array.from(selected.relationshipTypes)[0];
          this.navigateTo(selected.relatedObject, fieldName, direction, relType, undefined);
        }
      } else if (this.state.viewMode === 'object-view') {
        const target = this.objectView.getReferenceTo();
        const fieldName = this.objectView.getSelectedField()?.apiName;
        if (target) {
          this.closeObjectView();
          // From object view, we're always following a lookup (parent direction)
          // We don't have full relationship details here easily without querying, so passing undefined for now
          this.navigateTo(target, fieldName, 'parent');
        }
      }
    });

    // Navigation - up/down (works in main view and object-view)
    this.screen.key(['up', 'k'], () => {
      if (this.state.error) return; // Block nav when error is shown

      if (this.state.viewMode === 'main') {
        this.relationshipBrowser.moveUp();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view') {
        this.objectView.moveUp();
        this.screen.render();
      }
    });

    this.screen.key(['down', 'j'], () => {
      if (this.state.error) return; // Block nav when error is shown

      if (this.state.viewMode === 'main') {
        this.relationshipBrowser.moveDown();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view') {
        this.objectView.moveDown();
        this.screen.render();
      }
    });

    // Jump to next group (tab)
    this.screen.key('tab', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.relationshipBrowser.jumpToNextGroup();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view') {
        this.objectView.jumpToNextGroup();
        this.screen.render();
      }
    });

    // Go back
    this.screen.key('b', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.goBack();
      }
    });

    // Reset to start
    this.screen.key('r', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.reset();
      }
    });

    // Inspect field (right pane swap)
    this.screen.key('i', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.inspectField();
      }
    });

    // Inspect object (modal)
    this.screen.key('I', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.inspectObject();
      }
    });

    // Start filter
    this.screen.key('/', () => {
      if ((this.state.viewMode === 'main' || this.state.viewMode === 'object-view') && !this.state.filterActive) {
        this.startFilter();
      }
    });

    // Toggle between main (explorer) and object-view (fields)
    this.screen.key('x', () => {
      if (!this.state.filterActive) {
        if (this.state.viewMode === 'main') {
          this.showObjectView();
        } else if (this.state.viewMode === 'object-view') {
          this.closeObjectView();
        }
      }
    });

    // Escape - context-sensitive
    this.screen.key('escape', () => {
      if (this.state.filterActive) {
        this.clearFilter();
      } else if (this.state.viewMode === 'field-inspect') {
        this.closeFieldInspect();
      } else if (this.state.viewMode === 'object-modal') {
        this.closeObjectModal();
      } else if (this.state.viewMode === 'object-view') {
        this.closeObjectView();
      }
    });

    // Traverse from field inspect or object-view
    this.screen.key('t', () => {
      if (this.state.viewMode === 'field-inspect') {
        const target = this.fieldInspectView.getReferenceTo();
        if (target) {
          this.closeFieldInspect();
          this.navigateTo(target);
        }
      } else if (this.state.viewMode === 'object-view') {
        const target = this.objectView.getReferenceTo();
        if (target) {
          this.closeObjectView();
          this.navigateTo(target);
        }
      }
    });

    // Copy API name from field inspect or object-view
    this.screen.key('c', () => {
      if (this.state.viewMode === 'field-inspect') {
        const fieldName = this.fieldInspectView.getFieldApiName();
        if (fieldName) {
          this.copyToClipboard(fieldName);
        }
      } else if (this.state.viewMode === 'object-view') {
        const fieldName = this.objectView.getFieldApiName();
        if (fieldName) {
          this.copyToClipboard(fieldName);
        }
      }
    });

    // Cycle grouping mode in object-view
    this.screen.key('g', () => {
      if (this.state.viewMode === 'object-view') {
        this.objectView.cycleGroupMode();
        this.statusBar.updateForView('object-view', { isGrouped: this.objectView.isGrouped() });
        this.screen.render();
      }
    });

    // Collapse group (left/h)
    this.screen.key(['left', 'h'], () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.relationshipBrowser.collapseCurrentGroup();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view' && this.objectView.isGrouped()) {
        this.objectView.collapseCurrentGroup();
        this.screen.render();
      }
    });

    // Expand group (right/l)
    this.screen.key(['right', 'l'], () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.relationshipBrowser.expandCurrentGroup();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view' && this.objectView.isGrouped()) {
        this.objectView.expandCurrentGroup();
        this.screen.render();
      }
    });

    // Toggle group (space)
    this.screen.key('space', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.relationshipBrowser.toggleCurrentGroup();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view' && this.objectView.isGrouped()) {
        this.objectView.toggleCurrentGroup();
        this.screen.render();
      }
    });

    // Expand all groups (e)
    this.screen.key('e', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.relationshipBrowser.expandAllGroups();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view' && this.objectView.isGrouped()) {
        this.objectView.expandAllGroups();
        this.screen.render();
      }
    });

    // Collapse all groups (E/shift+e)
    this.screen.key('S-e', () => {
      if (this.state.viewMode === 'main' && !this.state.filterActive) {
        this.relationshipBrowser.collapseAllGroups();
        this.screen.render();
      } else if (this.state.viewMode === 'object-view' && this.objectView.isGrouped()) {
        this.objectView.collapseAllGroups();
        this.screen.render();
      }
    });

    // Number keys for path jumping (1-9)
    for (let i = 1; i <= 9; i++) {
      this.screen.key(String(i), () => {
        if (this.state.viewMode === 'main' && !this.state.filterActive) {
          this.jumpToPathNode(i - 1); // 0-indexed
        }
      });
    }
  }

  /**
   * Get the active filterable view based on filterSourceView state.
   */
  private getActiveFilterableView(): FilterableView {
    return this.state.filterSourceView === 'object-view' 
      ? this.objectView 
      : this.relationshipBrowser;
  }

  /**
   * Get the parent container for filter input based on filterSourceView.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getFilterParent(): any {
    return this.state.filterSourceView === 'object-view'
      ? this.objectView.container
      : this.relationshipBrowser.element;
  }

  /**
   * Restore status bar for the filter source view.
   */
  private restoreStatusBarForFilterSource(): void {
    if (this.state.filterSourceView === 'object-view') {
      this.statusBar.updateForView('object-view', { isGrouped: this.objectView.isGrouped() });
    } else {
      this.statusBar.updateForView('main');
    }
  }

  private setupFilterCallbacks(): void {
    this.filterInput.onChange((text) => {
      const filterText = text.replace(/^Filter:\s*/, '');
      this.getActiveFilterableView().setFilter(filterText);
      this.screen.render();
    });

    // Enter: just select (close filter, stay on current view)
    this.filterInput.onSubmit(() => {
      this.state.filterActive = false;
      this.filterInput.hide();
      this.getActiveFilterableView().clearFilter();
      this.restoreStatusBarForFilterSource();
      this.screen.render();
    });

    // Ctrl+O: select AND navigate to the item
    this.filterInput.onSubmitAndGo(() => {
      // Close filter mode first
      this.state.filterActive = false;
      this.filterInput.hide();
      this.getActiveFilterableView().clearFilter();
      this.screen.render();

      // Navigate based on which view we're in
      if (this.state.filterSourceView === 'object-view') {
        const target = this.objectView.getReferenceTo();
        const fieldName = this.objectView.getSelectedField()?.apiName;
        if (target) {
          this.closeObjectView();
          this.navigateTo(target, fieldName, 'parent');
        }
      } else {
        const selected = this.relationshipBrowser.getSelectedRelationship();
        this.statusBar.updateForView('main');
        if (selected) {
          const relType = Array.from(selected.relationshipTypes)[0];
          this.navigateTo(selected.relatedObject, selected.fields[0], selected.direction === 'outgoing' ? 'parent' : 'child', relType, undefined);
        }
      }
    });

    this.filterInput.onCancel(() => {
      this.clearFilter();
    });

    // Allow arrow key navigation while filter is active
    this.filterInput.onNavigate((direction) => {
      const view = this.getActiveFilterableView();
      if (direction === 'up') {
        view.moveUp();
      } else {
        view.moveDown();
      }
      this.screen.render();
    });
  }

  private showError(message: string): void {
    if (this.errorBox) {
      this.errorBox.setContent(`\n${message}\n\nPress Enter or Escape to close.`);
      this.errorBox.show();
      this.errorBox.setFront();
      this.screen.render();
    }
  }

  private hideError(): void {
    if (this.errorBox) {
      this.errorBox.hide();
      this.state.error = null;
      this.screen.render();
      
      // If we have no history (initial load failed), exit
      if (this.state.history.length === 0) {
        this.exit();
      }
    }
  }

  private async navigateTo(
    objectName: string,
    viaField?: string,
    direction?: 'parent' | 'child',
    relationshipType?: string,
    relationshipName?: string
  ): Promise<void> {
    this.state.loading = true;

    try {
      const object = await apiService.getObject(objectName, this.orgId);

      if (!object) {
        this.state.error = `Object '${objectName}' not found`;
        return;
      }

      // Check for cycles
      const seen = new Set(this.state.history.map(h => h.objectName));
      const isCycle = seen.has(objectName);

      // Update state with PathNode
      this.state.currentObject = object;
      this.state.history.push({
        objectName,
        fieldName: viaField,
        direction,
        isCycle,
        relationshipType,
        relationshipName
      });
      this.state.error = null;

      // Update UI
      this.objectHeader.update(object);
      this.relationshipBrowser.setObject(object);
      this.pathPanel.updatePath(this.state.history);
      this.screen.render();
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : 'Unknown error';
      this.showError(this.state.error);
    } finally {
      this.state.loading = false;
    }
  }

  private async goBack(): Promise<void> {
    if (this.state.history.length <= 1) return;

    this.state.history.pop();
    const prevNode = this.state.history[this.state.history.length - 1];

    // We need to reload the previous object, but keep the truncated history
    const tempHistory = [...this.state.history];
    this.state.history = tempHistory.slice(0, -1); // Remove last to avoid double-adding

    await this.navigateTo(prevNode.objectName);
  }

  private async reset(): Promise<void> {
    if (this.state.history.length === 0) return;

    const startNode = this.state.history[0];
    this.state.history = [];
    await this.navigateTo(startNode.objectName);
  }

  private async jumpToPathNode(index: number): Promise<void> {
    if (index >= this.state.history.length) return;

    const targetNode = this.state.history[index];
    // Truncate history to that point
    this.state.history = this.state.history.slice(0, index);
    await this.navigateTo(targetNode.objectName);
  }

  private inspectField(): void {
    const selected = this.relationshipBrowser.getSelectedRelationship();
    if (!selected) return;

    this.fieldInspectView.show(selected);
    this.pathPanel.element.hide();
    this.state.viewMode = 'field-inspect';
    this.statusBar.updateForView('field-inspect', { referenceTo: selected.relatedObject });
    this.screen.render();
  }

  private closeFieldInspect(): void {
    this.fieldInspectView.hide();
    this.pathPanel.element.show();
    this.state.viewMode = 'main';
    this.statusBar.updateForView('main');
    this.screen.render();
  }

  private inspectObject(): void {
    if (!this.state.currentObject) return;

    this.objectDetailModal.show(this.state.currentObject);
    this.state.viewMode = 'object-modal';
    this.statusBar.updateForView('object-modal');
    this.screen.render();
  }

  private closeObjectModal(): void {
    this.objectDetailModal.hide();
    this.state.viewMode = 'main';
    this.statusBar.updateForView('main');
    this.screen.render();
  }

  private showObjectView(): void {
    if (!this.state.currentObject) return;

    // Hide main view components
    this.relationshipBrowser.element.hide();
    this.pathPanel.element.hide();

    // Show object view
    this.objectView.show(this.state.currentObject);
    this.state.viewMode = 'object-view';
    this.statusBar.updateForView('object-view', { isGrouped: this.objectView.isGrouped() });
    this.screen.render();
  }

  private closeObjectView(): void {
    this.objectView.hide();

    // Show main view components
    this.relationshipBrowser.element.show();
    this.pathPanel.element.show();

    this.state.viewMode = 'main';
    this.statusBar.updateForView('main');
    this.screen.render();
  }

  private startFilter(): void {
    this.state.filterActive = true;
    this.state.filterSourceView = this.state.viewMode as 'main' | 'object-view';
    this.filterInput.setParent(this.getFilterParent());
    this.filterInput.show();
    this.statusBar.showFilterMode();
    this.screen.render();
  }

  private clearFilter(): void {
    this.state.filterActive = false;
    this.filterInput.hide();
    this.getActiveFilterableView().clearFilter();
    this.restoreStatusBarForFilterSource();
    this.screen.render();
  }

  private copyToClipboard(text: string): void {
    // Use macOS pbcopy
    exec(`echo "${text}" | pbcopy`, (err) => {
      if (!err) {
        // Show brief feedback
        const originalContent = this.statusBar.element.getContent();
        this.statusBar.element.setContent(`Copied: ${text}`);
        this.screen.render();

        setTimeout(() => {
          this.statusBar.element.setContent(originalContent);
          this.screen.render();
        }, 1500);
      }
    });
  }

  private exit(): void {
    this.screen.destroy();
    
    if (this.resolveStart) {
      this.resolveStart();
    }
  }
}

/**
 * Factory function to create and configure an Explorer instance.
 */
export async function createExplorer(options: ExplorerOptions = {}): Promise<Explorer> {
  return Explorer.create(options);
}
