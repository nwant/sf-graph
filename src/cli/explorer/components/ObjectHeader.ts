/**
 * Object Header Component
 *
 * Displays object metadata at the top of the explorer.
 * Visible in both relationship browser and object view modes.
 */

import { colors } from '../theme.js';
import type { ObjectDetails } from '../../../core/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

export class ObjectHeader {
  public element: BoxElement;

  private currentObject: ObjectDetails | null = null;

  constructor(blessed: Blessed, parent: Screen) {
    this.element = blessed.box({
      parent,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      tags: true,
      style: {
        fg: colors.fg.primary,
        bg: colors.bg.primary,
        border: { fg: colors.border.normal },
      },
    });
  }

  /**
   * Update header with object data.
   */
  update(object: ObjectDetails | null): void {
    this.currentObject = object;

    if (!object) {
      this.element.setContent('');
      this.element.setLabel('');
      return;
    }

    const totalFields = object.fields.length;
    const customFields = object.fields.filter((f) => f.category === 'custom').length;

    // Build header content
    const parts: string[] = [];
    parts.push(`API: ${object.apiName}`);
    parts.push(`Category: ${object.category}`);
    parts.push(`Fields: ${totalFields} (${customFields} custom)`);

    if (object.keyPrefix) {
      parts.push(`Prefix: ${object.keyPrefix}`);
    }

    this.element.setContent(' ' + parts.join('  │  '));
    // Use apiName as fallback if label is empty
    const displayLabel = object.label || object.apiName;
    this.element.setLabel(` ${displayLabel} `);
  }

  /**
   * Get current object.
   */
  getObject(): ObjectDetails | null {
    return this.currentObject;
  }
}
