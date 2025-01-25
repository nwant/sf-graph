/**
 * Explorer Types
 *
 * TypeScript types for the neo-blessed graph explorer.
 */

import type { ObjectDetails, ObjectRelationship } from '../../core/types.js';

// === State Types ===

export type ViewMode = 'main' | 'field-inspect' | 'object-modal' | 'object-view';
export type Section = 'parents' | 'children';

export interface ExplorerState {
  // Current object being viewed
  currentObject: ObjectDetails | null;

  // Navigation history (includes field names used to traverse)
  history: PathNode[];

  // UI state
  activeSection: Section;
  selectedIndex: number;

  // Filter state
  filterText: string;
  filterActive: boolean;
  filterSourceView: 'main' | 'object-view';  // Which view started the filter

  // View mode
  viewMode: ViewMode;
  selectedRelationship: ObjectRelationship | null;

  // Loading state
  loading: boolean;
  error: string | null;
}

// === Aggregated Types ===

export interface AggregatedRelationship {
  relatedObject: string;
  direction: 'outgoing' | 'incoming';
  fields: string[];
  fieldLabels: Map<string, string>;
  fieldDescriptions: Map<string, string>;
  relationshipTypes: Set<string>;
  isMasterDetail: boolean;
  isPolymorphic: boolean;
}

// === Path Types ===
import type { NavigationNode } from '../../core/types.js';
export type PathNode = NavigationNode;

// === Field Detail Types ===

export interface FieldDetail {
  apiName: string;
  label: string;
  type: string;
  referenceTo: string;
  required: boolean;
  cascade: boolean;
  reparentable: boolean;
  description?: string;
}

// === Object Detail Types ===

export interface ObjectMetadata {
  apiName: string;
  label: string;
  pluralLabel?: string;
  isCustom: boolean;
  recordCount?: number;
  keyPrefix?: string;
  sharingModel?: string;
  createdDate?: string;
  modifiedDate?: string;
  description?: string;
  fieldCount: number;
  customFieldCount: number;
  validationRuleCount?: number;
  triggerCount?: number;
  flowCount?: number;
}

// === Event Types ===

export type ExplorerAction =
  | { type: 'NAVIGATE'; objectName: string }
  | { type: 'GO_BACK' }
  | { type: 'RESET' }
  | { type: 'MOVE_UP' }
  | { type: 'MOVE_DOWN' }
  | { type: 'TOGGLE_SECTION' }
  | { type: 'INSPECT_FIELD' }
  | { type: 'INSPECT_OBJECT' }
  | { type: 'START_FILTER' }
  | { type: 'UPDATE_FILTER'; text: string }
  | { type: 'CLEAR_FILTER' }
  | { type: 'CLOSE_VIEW' }
  | { type: 'TRAVERSE_REFERENCE' }
  | { type: 'COPY_API_NAME' }
  | { type: 'JUMP_TO_PATH'; index: number }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_OBJECT'; object: ObjectDetails };

// === Options ===

export interface ExplorerOptions {
  orgId?: string;
  startObject?: string;
}
