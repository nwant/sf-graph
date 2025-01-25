/**
 * Field Pruning Services
 *
 * Provides strategies for reducing large field sets to query-relevant subsets.
 */

export {
  searchFieldsScoped,
  getFieldMaxScore,
  type ScopedFieldSearchOptions,
  type ScopedFieldResult,
} from './scoped-vector-search.js';
