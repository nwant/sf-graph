/**
 * Object Detail Modal
 *
 * Full-screen overlay showing complete object metadata.
 */

import { styles, colors } from '../theme.js';
import type { ObjectDetails, SalesforceField, ObjectRelationship } from '../../../core/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

export class ObjectDetailModal {
  public element: BoxElement;

  private currentObject: ObjectDetails | null = null;

  constructor(blessed: Blessed, parent: Screen) {
    this.element = blessed.box({
      parent,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: { type: 'line' },
      style: styles.modal,
      tags: true,
      hidden: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      scrollbar: {
        ch: ' ',
        track: { bg: colors.bg.secondary },
        style: { inverse: true },
      },
    });
  }

  /**
   * Show modal for an object.
   */
  show(object: ObjectDetails): void {
    this.currentObject = object;
    this.element.setLabel(` Object: ${object.apiName} `);
    this.render();
    this.element.show();
    this.element.focus();
  }

  /**
   * Hide the modal.
   */
  hide(): void {
    this.element.hide();
    this.currentObject = null;
  }

  /**
   * Check if modal is visible.
   */
  isVisible(): boolean {
    return this.element.visible;
  }

  private render(): void {
    if (!this.currentObject) {
      this.element.setContent('');
      return;
    }

    const obj = this.currentObject;
    const lines: string[] = [];

    // Basic info section
    lines.push('');
    this.addField(lines, 'API Name', obj.apiName);
    this.addField(lines, 'Label', obj.label);
    this.addField(lines, 'Category', obj.category);
    if (obj.subtype) {
      this.addField(lines, 'Subtype', obj.subtype);
    }
    if (obj.namespace) {
      this.addField(lines, 'Namespace', obj.namespace);
    }
    if (obj.keyPrefix) {
      this.addField(lines, 'Key Prefix', obj.keyPrefix);
    }

    lines.push('');

    // Field summary
    const customFieldCount = obj.fields.filter((f: SalesforceField) => f.category === 'custom').length;
    const standardFieldCount = obj.fields.length - customFieldCount;

    lines.push(`{${colors.fg.muted}-fg}Summary:{/}`);
    this.addField(lines, 'Total Fields', obj.fields.length.toString());
    this.addField(lines, 'Standard', standardFieldCount.toString());
    this.addField(lines, 'Custom', customFieldCount.toString());

    lines.push('');

    // Relationships summary
    const outgoing = obj.relationships.filter((r: ObjectRelationship) => r.direction === 'outgoing').length;
    const incoming = obj.relationships.filter((r: ObjectRelationship) => r.direction === 'incoming').length;

    lines.push(`{${colors.fg.muted}-fg}Relationships:{/}`);
    this.addField(lines, 'Parents', outgoing.toString());
    this.addField(lines, 'Children', incoming.toString());

    lines.push('');

    // Footer hint
    lines.push(`{${colors.fg.muted}-fg}esc:close{/}`);

    this.element.setContent(lines.join('\n'));
  }

  private addField(lines: string[], label: string, value: string): void {
    const paddedLabel = label.padEnd(14);
    lines.push(`{${colors.fg.muted}-fg}${paddedLabel}{/}${value}`);
  }
}
