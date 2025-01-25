/**
 * Entity Type Classifier
 *
 * Classifies extracted entities using the Semantic Knowledge Graph.
 * Delegates to ValueGroundingService for semantic-first classification.
 *
 * Entity types:
 * - Company names (use Name LIKE pattern)
 * - Person names (use Owner.Name or Contact.Name)
 * - Status/Priority values (use picklist field)
 * - Object references (use in FROM clause)
 * - Date references (use date field)
 * - Numeric values (use numeric field)
 */

import { createLogger } from '../core/index.js';
import type { ClassifiedEntity, EntityType, SoqlFilterPattern } from '../core/types.js';
import {
  createValueGroundingService,
  createGroundingGraphExecutor,
  createSoslExecutor,
  type GroundingResult,
  type GroundedEntity,
} from './grounding/index.js';
import { conn } from './salesforce.js';

const log = createLogger('entity-classifier');

// === Grounding to Classification Mapping ===

/**
 * Map GroundingResult type to EntityType.
 */
function mapGroundingTypeToEntityType(groundingType: GroundingResult['type']): EntityType {
  switch (groundingType) {
    case 'account_name':
    case 'company_name':
      return 'company_name';
    case 'contact_name':
    case 'person_name':
      return 'person_name';
    case 'picklist_value':
      return 'status_value';
    case 'priority_value':
      return 'priority_value';
    case 'status_value':
      return 'status_value';
    case 'object_reference':
      return 'object_reference';
    case 'date_reference':
      return 'date_reference';
    case 'numeric_value':
      return 'numeric_value';
    case 'id_reference':
      return 'object_reference';
    case 'field_reference':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/**
 * Convert GroundingResult to SoqlFilterPattern.
 */
function groundingToPattern(result: GroundingResult): SoqlFilterPattern {
  return {
    description: result.description || 'Suggested filter',
    pattern: result.suggestedFilter,
    fields: result.fields || [],
    confidence: result.confidence,
  };
}

/**
 * Convert GroundedEntity to ClassifiedEntity.
 */
function groundedToClassified(grounded: GroundedEntity): ClassifiedEntity {
  const bestMatch = grounded.bestMatch;

  if (!bestMatch) {
    // Check if the value looks like a proper noun (capitalized)
    // Proper nouns are likely company/person names
    const isProperNoun = /^[A-Z][a-z]+/.test(grounded.value);

    if (isProperNoun) {
      // Proper nouns without grounding should be treated as likely company/person names
      // Use Account.Name LIKE pattern as it's the most common case for business queries
      log.debug({ value: grounded.value }, 'Ungrounded proper noun detected, defaulting to company_name');
      return {
        value: grounded.value,
        type: 'company_name',
        confidence: 0.6, // Above threshold for entity hints
        suggestedPatterns: [
          {
            description: 'Filter by company/account name',
            pattern: `Account.Name LIKE '${grounded.value}%'`,
            fields: ['Account.Name'],
            confidence: 0.6,
          },
          {
            description: 'Or use Name LIKE for direct filtering',
            pattern: `Name LIKE '${grounded.value}%'`,
            fields: ['Name'],
            confidence: 0.5,
          },
        ],
      };
    }

    return {
      value: grounded.value,
      type: 'unknown',
      confidence: 0.3,
      suggestedPatterns: [
        {
          description: 'Generic Name filter',
          pattern: `Name LIKE '${grounded.value}%'`,
          fields: ['Name'],
          confidence: 0.3,
        },
      ],
    };
  }

  const entityType = mapGroundingTypeToEntityType(bestMatch.type);
  const patterns = grounded.groundedAs.map(groundingToPattern);

  const classified: ClassifiedEntity = {
    value: grounded.value,
    type: entityType,
    confidence: bestMatch.confidence,
    suggestedPatterns: patterns,
  };

  // Add matched object if object reference
  if (
    bestMatch.type === 'object_reference' &&
    bestMatch.evidence.matchedNode
  ) {
    classified.matchedObject = bestMatch.evidence.matchedNode;
  }

  // Add picklist match if picklist value
  if (bestMatch.type === 'picklist_value' && bestMatch.evidence.matchedNode) {
    const parts = bestMatch.evidence.matchedNode.split('.');
    if (parts.length >= 3) {
      classified.picklistMatch = {
        objectApiName: parts[0],
        fieldApiName: parts[1],
        matchedValue: parts[2],
      };
    }
  }

  return classified;
}

// === Grounding Service Singleton ===

let groundingService: ReturnType<typeof createValueGroundingService> | null = null;

/**
 * Get or create the grounding service.
 */
function getGroundingService() {
  if (!groundingService) {
    const graphExecutor = createGroundingGraphExecutor();

    // Create SOSL executor if Salesforce connection is available
    const soslExecutor = conn ? createSoslExecutor(conn) : undefined;

    groundingService = createValueGroundingService(graphExecutor, soslExecutor, {
      enableMetadataTier: true,
      enableInstanceTier: true, // Enable SOSL fallback when connection available
    });
  }
  return groundingService;
}

/**
 * Reset the grounding service (e.g., when connection changes).
 */
export function resetGroundingService(): void {
  groundingService = null;
}

// === Classification Functions ===

/**
 * Options for entity classification.
 */
export interface ClassifyEntityOptions {
  orgId?: string;
  /**
   * Context objects detected from the query (e.g., ["Opportunity", "Account"]).
   * Used to filter picklist matches to only context-relevant objects.
   */
  contextObjects?: string[];
}

/**
 * Classify an entity extracted from natural language.
 * Uses semantic grounding from the knowledge graph.
 */
export async function classifyEntity(
  value: string,
  options: ClassifyEntityOptions = {}
): Promise<ClassifiedEntity> {
  const trimmed = value.trim();

  log.debug({ value: trimmed, orgId: options.orgId, contextObjects: options.contextObjects }, 'Classifying entity via semantic grounding');

  try {
    const service = getGroundingService();

    const grounded = await service.groundValue(trimmed, {
      enableSemanticSearch: true,
      enableSoslFallback: conn !== null, // Only use SOSL if we have a connection
      maxResults: 5,
      contextObjects: options.contextObjects,
    });

    return groundedToClassified(grounded);
  } catch (error) {
    log.warn({ error, value: trimmed }, 'Semantic grounding failed, using fallback');
    return fallbackClassify(trimmed);
  }
}

/**
 * Fallback classification when grounding service is unavailable.
 * Uses basic pattern matching only.
 */
function fallbackClassify(value: string): ClassifiedEntity {
  // Date keywords
  const dateKeywords: Record<string, string> = {
    'today': 'TODAY',
    'yesterday': 'YESTERDAY',
    'tomorrow': 'TOMORROW',
    'this week': 'THIS_WEEK',
    'last week': 'LAST_WEEK',
    'next week': 'NEXT_WEEK',
    'this month': 'THIS_MONTH',
    'last month': 'LAST_MONTH',
    'next month': 'NEXT_MONTH',
    'this quarter': 'THIS_QUARTER',
    'last quarter': 'LAST_QUARTER',
    'this year': 'THIS_YEAR',
    'last year': 'LAST_YEAR',
  };

  const lowerValue = value.toLowerCase();
  if (dateKeywords[lowerValue]) {
    return {
      value,
      type: 'date_reference',
      confidence: 0.95,
      suggestedPatterns: [
        {
          description: 'Filter by CreatedDate',
          pattern: `CreatedDate = ${dateKeywords[lowerValue]}`,
          fields: ['CreatedDate'],
          confidence: 0.8,
        },
      ],
    };
  }

  // Numeric pattern
  const numericMatch = value.match(/^(\$?)(\d+(?:,\d{3})*(?:\.\d{2})?)(k|K|m|M)?$/);
  if (numericMatch) {
    let numValue = parseFloat(numericMatch[2].replace(/,/g, ''));
    if (numericMatch[3]?.toLowerCase() === 'k') numValue *= 1000;
    if (numericMatch[3]?.toLowerCase() === 'm') numValue *= 1000000;

    return {
      value,
      type: 'numeric_value',
      confidence: 0.95,
      suggestedPatterns: [
        {
          description: 'Filter by Amount',
          pattern: `Amount >= ${numValue}`,
          fields: ['Amount'],
          confidence: 0.8,
        },
      ],
    };
  }

  // Salesforce ID pattern (15 or 18 chars)
  if (/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(value)) {
    return {
      value,
      type: 'object_reference',
      confidence: 0.95,
      suggestedPatterns: [
        {
          description: 'Filter by ID',
          pattern: `Id = '${value}'`,
          fields: ['Id'],
          confidence: 0.95,
        },
      ],
    };
  }

  // Title case heuristic - likely a name
  const isTitleCase = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(value);

  return {
    value,
    type: 'unknown',
    confidence: isTitleCase ? 0.5 : 0.3,
    suggestedPatterns: isTitleCase
      ? [
          {
            description: 'If this is an account/company name, use Name LIKE',
            pattern: `Name LIKE '${value}%'`,
            fields: ['Name'],
            confidence: 0.5,
          },
          {
            description: "If this is a person name, use Owner.Name",
            pattern: `Owner.Name LIKE '${value}%'`,
            fields: ['Owner.Name'],
            confidence: 0.4,
          },
        ]
      : [
          {
            description: 'Generic Name filter',
            pattern: `Name LIKE '${value}%'`,
            fields: ['Name'],
            confidence: 0.3,
          },
        ],
  };
}

/**
 * Batch classify multiple entities.
 */
export async function classifyEntities(
  values: string[],
  options: ClassifyEntityOptions = {}
): Promise<ClassifiedEntity[]> {
  // Deduplicate values
  const unique = [...new Set(values)];

  // Classify in parallel
  const results = await Promise.all(
    unique.map((v) => classifyEntity(v, options))
  );

  return results;
}

/**
 * Get explanation for entity misuse in validation errors.
 */
export function getEntityMisuseExplanation(
  value: string,
  entityType: EntityType,
  objectName: string
): string {
  switch (entityType) {
    case 'company_name':
      return (
        `"${value}" appears to be a company/account name, not a field. ` +
        `Use \`${objectName}.Name LIKE '${value}%'\` to filter by name instead.`
      );
    case 'person_name':
      return (
        `"${value}" appears to be a person's name, not a field. ` +
        `Use \`Owner.Name LIKE '${value}%'\` or filter via User subquery.`
      );
    case 'status_value':
      return (
        `"${value}" appears to be a status value, not a field. ` +
        `Use the Status field with this value: \`Status = '${value}'\`.`
      );
    case 'priority_value':
      return (
        `"${value}" appears to be a priority value, not a field. ` +
        `Use the Priority field with this value: \`Priority = '${value}'\`.`
      );
    default:
      return `"${value}" doesn't match any known field on ${objectName}.`;
  }
}

// === Pre-Generation Value Grounding for Decomposer ===

/**
 * Default timeout for grounding context building (ms).
 * "Better fast and ungrounded than slow and perfect" for chat UX.
 */
const GROUNDING_TIMEOUT_MS = 2000;

/**
 * Options for building Decomposer grounding context.
 */
export interface DecomposerGroundingOptions {
  orgId?: string;
  timeoutMs?: number;
  contextObjects?: string[];
}

/**
 * Build grounding context to inject into the Decomposer prompt.
 * This helps the Decomposer understand which tables/fields contain
 * the values mentioned in the user's query.
 *
 * Uses a timeout to prevent blocking the chat interface.
 * If grounding times out, returns empty string (proceed without hints).
 *
 * @param entities - Extracted entity values from the query
 * @param options - Grounding options including orgId and timeout
 * @returns Formatted grounding notes string for Decomposer prompt
 */
export async function buildDecomposerGroundingContext(
  entities: string[],
  options: DecomposerGroundingOptions = {}
): Promise<string> {
  const { orgId, timeoutMs = GROUNDING_TIMEOUT_MS, contextObjects } = options;

  if (entities.length === 0) {
    return '';
  }

  log.debug({ entities, orgId, timeoutMs }, 'Building Decomposer grounding context');

  // Create timeout promise
  const timeoutPromise = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error('Grounding timeout')), timeoutMs)
  );

  try {
    // Race grounding against timeout
    const classified = await Promise.race([
      classifyEntities(entities, { orgId, contextObjects }),
      timeoutPromise,
    ]);

    if (!classified || classified.length === 0) {
      return '';
    }

    // Format grounding notes
    const notes: string[] = [];

    for (const entity of classified) {
      const bestPattern = entity.suggestedPatterns[0];

      if (!bestPattern) {
        notes.push(`- No match found for "${entity.value}" (may need manual field lookup)`);
        continue;
      }

      // Format based on entity type
      switch (entity.type) {
        case 'status_value':
          if (entity.picklistMatch) {
            notes.push(
              `- "${entity.value}" found in ${entity.picklistMatch.objectApiName}.${entity.picklistMatch.fieldApiName} ` +
                `(picklist, confidence: ${entity.confidence.toFixed(2)})`
            );
          } else {
            notes.push(
              `- "${entity.value}" appears to be a status/picklist value ` +
                `(confidence: ${entity.confidence.toFixed(2)})`
            );
          }
          break;

        case 'priority_value':
          notes.push(
            `- "${entity.value}" appears to be a priority value ` +
              `(suggest: Priority = '${entity.value}', confidence: ${entity.confidence.toFixed(2)})`
          );
          break;

        case 'company_name':
          notes.push(
            `- "${entity.value}" appears to be a company/account name ` +
              `(suggest: Account.Name LIKE, confidence: ${entity.confidence.toFixed(2)})`
          );
          break;

        case 'person_name':
          notes.push(
            `- "${entity.value}" appears to be a person name ` +
              `(suggest: Owner.Name or Contact.Name, confidence: ${entity.confidence.toFixed(2)})`
          );
          break;

        case 'date_reference':
          notes.push(
            `- "${entity.value}" is a date literal ` +
              `(use: ${bestPattern.pattern}, confidence: ${entity.confidence.toFixed(2)})`
          );
          break;

        case 'numeric_value':
          notes.push(
            `- "${entity.value}" is a numeric value ` +
              `(suggest: Amount/currency field, confidence: ${entity.confidence.toFixed(2)})`
          );
          break;

        case 'object_reference':
          if (entity.matchedObject) {
            notes.push(
              `- "${entity.value}" matches object ${entity.matchedObject} ` +
                `(confidence: ${entity.confidence.toFixed(2)})`
            );
          }
          break;

        default:
          if (entity.confidence >= 0.5) {
            notes.push(
              `- "${entity.value}": ${bestPattern.description} ` +
                `(confidence: ${entity.confidence.toFixed(2)})`
            );
          }
      }
    }

    if (notes.length === 0) {
      return '';
    }

    return `VALUE GROUNDING NOTES:\n${notes.join('\n')}`;
  } catch (error) {
    if ((error as Error).message === 'Grounding timeout') {
      log.warn({ entities, timeoutMs }, 'Grounding timed out, proceeding without hints');
    } else {
      log.warn({ error, entities }, 'Grounding failed, proceeding without hints');
    }
    return '';
  }
}
