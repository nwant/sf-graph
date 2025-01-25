/**
 * Field Inspect View
 *
 * Right-pane swap showing detailed field/relationship metadata.
 */

import { styles, layout, colors } from '../theme.js';
import type { AggregatedRelationship } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoxElement = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Screen = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Blessed = any;

export class FieldInspectView {
  public element: BoxElement;

  private currentRelationship: AggregatedRelationship | null = null;

  constructor(blessed: Blessed, parent: Screen) {
    this.element = blessed.box({
      parent,
      top: 0,
      right: 0,
      width: layout.rightPaneWidth,
      height: '100%-1',
      border: layout.border,
      style: styles.box.default,
      tags: true,
      hidden: true, // Hidden by default
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: { bg: colors.bg.secondary },
        style: { inverse: true },
      },
    });
  }

  /**
   * Show field details for a relationship.
   */
  show(relationship: AggregatedRelationship): void {
    this.currentRelationship = relationship;

    const fieldName = relationship.fields[0] ?? 'Unknown';
    this.element.setLabel(` Field: ${fieldName} `);

    this.render();
    this.element.show();
  }

  /**
   * Hide the view.
   */
  hide(): void {
    this.element.hide();
    this.currentRelationship = null;
  }

  /**
   * Check if visible.
   */
  isVisible(): boolean {
    return this.element.visible;
  }

  /**
   * Get the target object for traversal.
   */
  getReferenceTo(): string | null {
    return this.currentRelationship?.relatedObject ?? null;
  }

  /**
   * Get field API name for copying.
   */
  getFieldApiName(): string | null {
    return this.currentRelationship?.fields[0] ?? null;
  }

  private render(): void {
    if (!this.currentRelationship) {
      this.element.setContent('');
      return;
    }

    const rel = this.currentRelationship;
    const fieldApiName = rel.fields[0] ?? 'Unknown';
    const fieldLabel = rel.fieldLabels.get(fieldApiName) || fieldApiName;

    const lines: string[] = [];

    // Field info
    this.addField(lines, 'API Name', fieldApiName);
    this.addField(lines, 'Label', fieldLabel);
    this.addField(lines, 'Type', this.getRelationshipTypeLabel(rel));
    this.addField(lines, 'References', rel.relatedObject);

    // Relationship details
    const isMD = rel.isMasterDetail;
    this.addField(lines, 'Required', isMD ? 'true' : 'false');
    this.addField(lines, 'Cascade', isMD ? 'true' : 'false');
    this.addField(lines, 'Reparentable', isMD ? 'false' : 'N/A');

    lines.push('');

    // Description - use actual description if available
    lines.push(`{${colors.fg.muted}-fg}Description:{/}`);
    lines.push(this.getDescription(rel, fieldApiName));

    this.element.setContent(lines.join('\n'));
  }

  private addField(lines: string[], label: string, value: string): void {
    const paddedLabel = label.padEnd(14);
    lines.push(`{${colors.fg.muted}-fg}${paddedLabel}{/}${value}`);
  }

  private getRelationshipTypeLabel(rel: AggregatedRelationship): string {
    if (rel.isMasterDetail) return 'Master-Detail';
    if (rel.relationshipTypes.has('Hierarchical')) return 'Hierarchical';
    return 'Lookup';
  }

  private getDescription(rel: AggregatedRelationship, fieldApiName: string): string {
    // Return actual description from database (empty if not set)
    return rel.fieldDescriptions.get(fieldApiName) || '';
  }
}
