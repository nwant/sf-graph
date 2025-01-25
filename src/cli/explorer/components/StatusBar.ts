/**
 * Status Bar Component
 *
 * Bottom bar showing context-sensitive keybinding hints.
 */

import { styles, keyHints } from '../theme.js';
import type { ViewMode } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

export class StatusBar {
  public element: BoxElement;

  constructor(blessed: Blessed, parent: Screen) {
    this.element = blessed.box({
      parent,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: keyHints.main,
      style: styles.statusBar,
      tags: true,
    });
  }

  updateForView(viewMode: ViewMode, context?: { referenceTo?: string; isGrouped?: boolean }): void {
    let hint = keyHints.main;

    switch (viewMode) {
      case 'field-inspect':
        hint = keyHints.fieldInspect;
        if (context?.referenceTo) {
          hint = hint.replace('Account', context.referenceTo);
        }
        break;
      case 'object-modal':
        hint = keyHints.objectModal;
        break;
      case 'object-view':
        hint = context?.isGrouped ? keyHints.objectViewGrouped : keyHints.objectView;
        break;
      case 'main':
      default:
        hint = keyHints.main;
        break;
    }

    this.element.setContent(hint);
  }

  showFilterMode(): void {
    this.element.setContent(keyHints.filter);
  }
}
