/**
 * Filter Input Component
 *
 * Inline text input for filtering relationships with support for:
 * - Real-time filter updates
 * - Tab/Shift+Tab for list navigation
 * - Ctrl+O for select and go
 * - Enter for select
 * - Escape for cancel
 */

import { colors } from '../theme.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TextboxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

export class FilterInput {
  public element: TextboxElement;

  private onChangeCallback?: (text: string) => void;
  private onSubmitCallback?: () => void;
  private onSubmitAndGoCallback?: () => void;  // Submit and navigate
  private onCancelCallback?: () => void;
  private onNavigateCallback?: (direction: 'up' | 'down') => void;

  constructor(blessed: Blessed, parent: BoxElement) {
    this.element = blessed.textbox({
      parent,
      top: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      hidden: true,
      inputOnFocus: true,
      style: {
        fg: colors.fg.primary,
        bg: colors.bg.secondary,
      },
    });
    // Handle input events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.element.on('keypress', (_ch: string, key: any) => {
      // Handle Ctrl+O for submit and navigate (open/go)
      if (key && key.ctrl && key.name === 'o') {
        if (this.onSubmitAndGoCallback) {
          // Cancel input mode and call our callback
          this.element.cancel();
          this.onSubmitAndGoCallback();
        }
        return;
      }
      
      // Handle Tab for list navigation - prevent insertion into textbox
      if (key && key.name === 'tab') {
        if (this.onNavigateCallback) {
          this.onNavigateCallback(key.shift ? 'up' : 'down');
        }
        // Remove the tab character that was just inserted
        setImmediate(() => {
          const value = this.element.getValue().replace(/\t/g, '');
          this.element.setValue(value);
          this.element.screen.render();
        });
        return;
      }
      
      // Use setImmediate to get the updated value after keypress
      setImmediate(() => {
        const value = this.element.getValue();
        if (this.onChangeCallback) {
          this.onChangeCallback(value);
        }
      });
    });

    this.element.on('submit', () => {
      if (this.onSubmitCallback) {
        this.onSubmitCallback();
      }
    });

    this.element.on('cancel', () => {
      if (this.onCancelCallback) {
        this.onCancelCallback();
      }
    });
  }

  /**
   * Show and focus the filter input.
   */
  show(): void {
    this.element.setValue('Filter: ');
    this.element.show();
    this.element.focus();
    this.element.readInput();
  }

  /**
   * Hide the filter input.
   */
  hide(): void {
    this.element.hide();
    this.element.setValue('');
  }

  /**
   * Check if visible.
   */
  isVisible(): boolean {
    return this.element.visible;
  }

  /**
   * Reparent the filter input to a different container.
   */
  setParent(parent: BoxElement): void {
    // Remove from current parent
    if (this.element.parent) {
      this.element.detach();
    }
    // Add to new parent
    parent.append(this.element);
  }

  /**
   * Get current filter text (without "Filter: " prefix).
   */
  getValue(): string {
    const value = this.element.getValue();
    return value.replace(/^Filter:\s*/, '');
  }

  /**
   * Set callback for text changes.
   */
  onChange(callback: (text: string) => void): void {
    this.onChangeCallback = callback;
  }

  /**
   * Set callback for submit (Enter).
   */
  onSubmit(callback: () => void): void {
    this.onSubmitCallback = callback;
  }

  /**
   * Set callback for cancel (Escape).
   */
  onCancel(callback: () => void): void {
    this.onCancelCallback = callback;
  }

  /**
   * Set callback for arrow key navigation.
   */
  onNavigate(callback: (direction: 'up' | 'down') => void): void {
    this.onNavigateCallback = callback;
  }

  /**
   * Set callback for submit and navigate (Ctrl+O).
   */
  onSubmitAndGo(callback: () => void): void {
    this.onSubmitAndGoCallback = callback;
  }
}
