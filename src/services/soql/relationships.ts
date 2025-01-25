/**
 * SOQL Relationship Validation
 *
 * Parent lookup and child subquery validation.
 */

import {
  getObjectRelationships,
  getChildRelationships,
  getObjectFields,
} from '../neo4j/graph-service.js';
import type { SoqlValidationMessage } from '../../core/types.js';
import { createLogger } from '../../core/index.js';
import { apiService } from '../../core/api-service.js';
import { VALIDATION_ERROR_PATTERNS } from '../../core/validation-errors.js';
import { findClosestMatch } from './utils.js';
import { findRelationshipMatch } from './matching.js';

const log = createLogger('soql-relationships');

/**
 * Validate a parent lookup path (e.g., Account.Name on Contact).
 */
export async function validateParentLookup(
  fromObject: string,
  lookupPath: string,
  field: string,
  orgId?: string
): Promise<{ isValid: boolean; error?: string; suggestion?: string }> {
  try {
    const parts = lookupPath.split('.');
    let currentObject = fromObject;

    for (const part of parts) {
      const relationships = await getObjectRelationships(currentObject, { orgId });
      const matchResult = findRelationshipMatch(part, relationships);

      if (!matchResult.found) {
        // Use centralized pattern as base, then add context
        let errorMsg = VALIDATION_ERROR_PATTERNS.RELATIONSHIP_NOT_FOUND.template(
          part,
          currentObject
        );

        if (matchResult.suggestion) {
          errorMsg += `. Did you mean "${matchResult.suggestion}"`;
          if (matchResult.suggestedTarget) {
            errorMsg += ` (targets ${matchResult.suggestedTarget})`;
          }
          errorMsg += '?';
        } else {
          const availableRels = relationships
            .filter((r) => r.direction === 'outgoing' && r.relationshipName)
            .map((r) => r.relationshipName)
            .slice(0, 5);
          if (availableRels.length > 0) {
            errorMsg += `. Available: ${availableRels.join(', ')}${relationships.length > 5 ? '...' : ''}`;
          }
        }

        return {
          isValid: false,
          error: errorMsg,
          suggestion: matchResult.suggestion,
        };
      }

      currentObject = matchResult.relationship!.targetObject;
    }

    const targetObject = currentObject;
    const targetFields = await getObjectFields(targetObject, { orgId });
    const fieldExists = targetFields.some(f => f.apiName.toLowerCase() === field.toLowerCase());

    if (!fieldExists) {
      const fieldSuggestion = findClosestMatch(field, targetFields.map(f => f.apiName));
      let errorMsg = `Field "${field}" not found on ${targetObject}`;
      if (fieldSuggestion) {
        errorMsg += `. Did you mean "${fieldSuggestion}"?`;
      }
      return { isValid: false, error: errorMsg, suggestion: fieldSuggestion || undefined };
    }

    return { isValid: true };
  } catch (error) {
    return { isValid: false, error: String(error) };
  }
}

/**
 * Validate a child subquery relationship.
 */
export async function validateSubquery(
  parentObject: string,
  relationshipName: string,
  fields: string[],
  orgId?: string
): Promise<{ messages: SoqlValidationMessage[] }> {
  const messages: SoqlValidationMessage[] = [];
  let childObject: string | undefined;

  // 1. Graph lookup (fast, cached)
  try {
    const childRels = await getChildRelationships(parentObject, { orgId });
    const matchedRel = childRels.find(r => 
      r.relationshipName.toLowerCase() === relationshipName.toLowerCase()
    );
    
    if (matchedRel) {
      childObject = matchedRel.childObject;
      log.debug({ relationshipName, childObject, parentObject }, 'Found child relationship in graph');
    }
  } catch (error) {
    log.debug({ err: error, parentObject }, 'Graph lookup for child relationships failed');
  }

  // 2. JIT: Check live Salesforce metadata if graph miss
  if (!childObject && orgId) {
    try {
      const describe = await apiService.describeSObject(parentObject, orgId);
      const liveMatch = describe.childRelationships?.find(r =>
        r.relationshipName?.toLowerCase() === relationshipName.toLowerCase()
      );
      if (liveMatch?.childSObject) {
        childObject = liveMatch.childSObject;
        log.debug({ relationshipName, childObject }, 'Found via JIT API lookup');
      }
    } catch (err) {
      log.debug({ err, parentObject }, 'JIT metadata check failed');
    }
  }

  // 3. Validate fields if we found the child object
  if (childObject) {
    try {
      const childFields = await getObjectFields(childObject, { orgId });
      const childFieldNames = new Set(childFields.map(f => f.apiName.toLowerCase()));

      for (const field of fields) {
        if (field.includes('.') || field.includes('(')) continue;

        if (!childFieldNames.has(field.toLowerCase())) {
          messages.push({
            type: 'warning',
            message: `Field "${field}" may not exist on ${childObject} (in ${relationshipName} subquery)`,
          });
        }
      }
    } catch (fieldError) {
      log.debug({ err: fieldError, childObject }, 'Could not validate subquery fields');
    }
  } else {
    // 4. Error with suggestions from graph
    const childRels = await getChildRelationships(parentObject, { orgId }).catch(() => []);
    const availableNames = childRels.map(r => r.relationshipName);
    const suggestion = findClosestMatch(relationshipName, availableNames);

    messages.push({
      type: 'error',
      message: suggestion
        ? VALIDATION_ERROR_PATTERNS.CHILD_RELATIONSHIP_NOT_FOUND_WITH_SUGGESTION.template(
            relationshipName,
            parentObject,
            suggestion
          )
        : VALIDATION_ERROR_PATTERNS.CHILD_RELATIONSHIP_NOT_FOUND.template(
            relationshipName,
            parentObject
          ) +
          '. ' +
          (availableNames.length > 0
            ? `Available: ${availableNames.slice(0, 5).join(', ')}${availableNames.length > 5 ? '...' : ''}`
            : `If valid, sync metadata: 'sf graph sync --object ${parentObject}'`),
    });
    log.debug({ relationshipName, parentObject, suggestion }, 'Unknown child relationship');
  }

  return { messages };
}
