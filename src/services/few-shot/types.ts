/**
 * Few-Shot Example Types
 *
 * Type definitions for the dynamic few-shot selection system (DAIL-SQL).
 */

/**
 * A high-quality Question-SOQL pair for few-shot prompting.
 */
export interface SoqlExample {
  /** Unique identifier */
  id: string;
  /** Natural language question */
  question: string;
  /** Correct SOQL query */
  soql: string;
  /** Query complexity level */
  complexity: 'simple' | 'medium' | 'complex';
  /** Pattern tags for categorization */
  patterns: SoqlPattern[];
  /** Salesforce objects involved */
  objects: string[];
  /** Optional reasoning explanation */
  explanation?: string;
}

/**
 * SoqlExample stored in Neo4j with embedding metadata.
 */
export interface StoredSoqlExample extends SoqlExample {
  /** Embedding model used to generate the vector */
  embeddingModel: string;
  /** Content hash for change detection */
  contentHash: string;
}

/**
 * Known SOQL pattern tags.
 */
export type SoqlPattern =
  | 'simple'
  | 'filter'
  | 'join'
  | 'parent-lookup'
  | 'child-subquery'
  | 'subquery'
  | 'aggregate'
  | 'group-by'
  | 'polymorphic'
  | 'typeof'
  | 'date-literal'
  | 'limit'
  | 'order-by'
  | 'like'
  | 'in-clause';

/**
 * Result from similarity search.
 */
export interface ExampleSearchResult {
  example: SoqlExample;
  score: number;
}
