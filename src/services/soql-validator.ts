/**
 * SOQL Validator Service
 * 
 * Validates and corrects SOQL queries against the metadata graph.
 * Works with LLM-generated SOQL to ensure object/field/relationship validity.
 * 
 * This file re-exports validation utilities from `./soql/` module and provides
 * the main `validateAndCorrectSoql` and `validateAndCorrectSoqlEnhanced` functions.
 */

import {
  getAllObjects,
  getObjectFields,
} from './neo4j/graph-service.js';
import type {
  SoqlValidationResult,
  SoqlValidationMessage,
  EnhancedValidationResult,
  EnhancedValidationError,
} from '../core/types.js';
import { createLogger } from '../core/index.js';
import { VALIDATION_ERROR_PATTERNS } from '../core/validation-errors.js';
import {
  classifyEntity,
  getEntityMisuseExplanation,
} from './entity-classifier.js';
import {
  parseSoqlToAst,
  extractWhereComparisons,
  extractSemiJoins,
  getFieldNames,
} from './soql-ast-parser.js';
import type { Query } from '@jetstreamapp/soql-parser-js';

// Import from modular soql package
import {
  findObjectMatch,
  findFieldMatch,
  validateParentLookup,
  validateSubquery,
  validateAggregates,
  checkSyntax,
  checkSuspiciousIds,
  validateSemiJoinsFromAst,
  validatePicklistValuesWithAst,
  checkToolingApiConstraints,
  checkGovernorLimits,
  // AST mutation functions
  mutateMainObject,
  mutateFieldInSelect,
  mutateParentLookupPath,
  mutateWhereClauseField,
  recomposeQuery,
} from './soql/index.js';

// Re-export for backwards compatibility and public API
export {
  // Matching utilities
  findObjectMatch,
  findFieldMatch,
  findRelationshipMatch,
  findClosestPicklistValue,
  levenshteinDistance,
  findClosestMatch,
  // Validation functions
  validateParentLookup,
  validateSubquery,
  validateAggregates,
  isAggregateFunction,
  normalizeNode,
  checkSyntax,
  checkSuspiciousIds,
  validateSemiJoinsFromAst,
  validatePicklistValuesWithAst,
  checkToolingApiConstraints,
  TOOLING_API_OBJECTS,
  checkGovernorLimits,
  applySuggestedLimit,
  DEFAULT_LIMIT,
  // AST mutation functions (new)
  mutateMainObject,
  mutateFieldInSelect,
  mutateParentLookupPath,
  mutateWhereClauseField,
  mutateSubqueryField,
  recomposeQuery,
  // Legacy utilities (deprecated)
  escapeRegex,
  replaceFieldInSelect,
  // Types
  type MatchResult,
  type RelationshipMatchResult,
  type GovernorLimitResult,
} from './soql/index.js';

const log = createLogger('soql-validator');

/**
 * Apply a correction for an invalid parent lookup path using AST mutation.
 * Mutates the query AST in-place and returns the correction message.
 */
function applyLookupCorrection(
  query: Query,
  path: string,
  field: string,
  suggestion: string,
  error: string | undefined,
  context: 'SELECT' | 'WHERE'
): SoqlValidationMessage {
  const originalPath = `${path}.${field}`;
  const isFieldSuggestion = error?.includes(`Field "${field}"`);

  let correctedPath: string;
  let message: SoqlValidationMessage;

  if (isFieldSuggestion) {
    correctedPath = `${path}.${suggestion}`;
    const contextLabel = context === 'WHERE' ? ' in WHERE' : '';
    message = {
      type: 'correction',
      message: `Field "${field}"${contextLabel} corrected to "${suggestion}" on ${path}`,
      original: originalPath,
      corrected: correctedPath,
    };
  } else {
    const pathParts = path.split('.');
    const lastPart = pathParts[pathParts.length - 1];
    const correctedPathParts = [...pathParts.slice(0, -1), suggestion];
    correctedPath =
      correctedPathParts.length > 0 && correctedPathParts[0] !== ''
        ? `${correctedPathParts.join('.')}.${field}`
        : `${suggestion}.${field}`;
    const contextLabel = context === 'WHERE' ? ' in WHERE' : '';
    message = {
      type: 'correction',
      message: `Relationship "${lastPart}"${contextLabel} corrected to "${suggestion}"`,
      original: originalPath,
      corrected: correctedPath,
    };
  }

  // Mutate AST in-place based on context
  if (context === 'SELECT') {
    mutateParentLookupPath(query, originalPath, correctedPath);
  } else {
    mutateWhereClauseField(query.where, originalPath, correctedPath);
  }

  return message;
}

// === Main Validation Function ===

/**
 * Validate and correct a SOQL query against the metadata graph.
 */
export async function validateAndCorrectSoql(
  soql: string,
  orgId?: string
): Promise<SoqlValidationResult> {
  const messages: SoqlValidationMessage[] = [];
  let correctedSoql = soql;
  let wasCorrected = false;

  // Step 0: Syntax Check
  const syntaxErrors = checkSyntax(soql);
  if (syntaxErrors.length > 0) {
    return { isValid: false, soql, wasCorrected: false, messages: syntaxErrors };
  }

  const idErrors = checkSuspiciousIds(soql);
  if (idErrors.length > 0) {
    return { isValid: false, soql, wasCorrected: false, messages: idErrors };
  }

  try {
    // Step 1: Parse SOQL
    const astParsed = parseSoqlToAst(soql);
    if (!astParsed) {
      return {
        isValid: false,
        soql,
        wasCorrected: false,
        messages: [{ type: 'error', message: 'Could not parse SOQL query' }],
      };
    }
    
    // Keep reference to raw AST for mutations
    const rawQuery = astParsed.raw;

    let mainObject = astParsed.mainObject;
    const fields = getFieldNames(astParsed.fields);
    const parentLookups = astParsed.parentLookups;
    const subqueries = astParsed.subqueries;

    log.debug({ mainObject, fieldCount: fields.length }, 'Parsed SOQL components via AST');

    // Step 1.5: Check Tooling API constraints (before any other validation)
    const toolingErrors = checkToolingApiConstraints(astParsed, mainObject);
    if (toolingErrors.length > 0) {
      return {
        isValid: false,
        soql,
        wasCorrected: false,
        messages: toolingErrors,
      };
    }

    // Step 2: Validate main object
    const allObjects = await getAllObjects({ orgId });
    const objectMatch = findObjectMatch(mainObject, allObjects);

    if (!objectMatch.found) {
      if (objectMatch.suggestion) {
        messages.push({
          type: 'correction',
          message: VALIDATION_ERROR_PATTERNS.OBJECT_NOT_FOUND_WITH_SUGGESTION.template(
            mainObject,
            objectMatch.suggestion
          ),
          original: mainObject,
          corrected: objectMatch.suggestion,
        });
        // Use AST mutation instead of regex
        mutateMainObject(rawQuery, objectMatch.suggestion);
        mainObject = objectMatch.suggestion;
        wasCorrected = true;
      } else {
        messages.push({
          type: 'error',
          message: VALIDATION_ERROR_PATTERNS.OBJECT_NOT_FOUND.template(mainObject),
        });
        return { isValid: false, soql, wasCorrected: false, messages };
      }
    } else if (objectMatch.correctedName && objectMatch.correctedName !== mainObject) {
      // Use AST mutation instead of regex
      mutateMainObject(rawQuery, objectMatch.correctedName);
      mainObject = objectMatch.correctedName;
      wasCorrected = true;
    }

    // Step 3: Validate fields
    const objectFields = await getObjectFields(mainObject, { orgId });

    for (const field of fields) {
      if (field.includes('.') || field.startsWith('(')) continue;
      const fieldMatch = findFieldMatch(field, objectFields);

      if (!fieldMatch.found) {
        if (fieldMatch.suggestion) {
          messages.push({
            type: 'correction',
            message: VALIDATION_ERROR_PATTERNS.FIELD_NOT_FOUND_WITH_SUGGESTION.template(
              field,
              mainObject,
              fieldMatch.suggestion
            ),
            original: field,
            corrected: fieldMatch.suggestion,
          });
          // Use AST mutation instead of regex
          mutateFieldInSelect(rawQuery, field, fieldMatch.suggestion);
          wasCorrected = true;
        } else {
          messages.push({
            type: 'error',
            message: VALIDATION_ERROR_PATTERNS.FIELD_NOT_FOUND.template(field, mainObject),
          });
        }
      } else if (fieldMatch.correctedName && fieldMatch.correctedName !== field) {
        // Use AST mutation instead of regex
        mutateFieldInSelect(rawQuery, field, fieldMatch.correctedName);
        wasCorrected = true;
      }
    }

    // Step 4: Validate parent lookups
    for (const lookup of parentLookups) {
      const validationResult = await validateParentLookup(
        mainObject, lookup.path, lookup.field, orgId
      );

      if (!validationResult.isValid) {
        if (validationResult.suggestion) {
          // applyLookupCorrection now mutates AST in-place and returns message
          const message = applyLookupCorrection(
            rawQuery, lookup.path, lookup.field,
            validationResult.suggestion, validationResult.error, 'SELECT'
          );
          messages.push(message);
          wasCorrected = true;
        } else {
          messages.push({
            type: 'error',
            message: validationResult.error || `Invalid parent lookup: ${lookup.path}.${lookup.field}`,
          });
        }
      }
    }

    // Step 5: Validate child subqueries
    for (const subquery of subqueries) {
      const subqueryValidation = await validateSubquery(
        mainObject, subquery.relationshipName, subquery.fields, orgId
      );
      messages.push(...subqueryValidation.messages);
    }

    // Step 6: Validate picklist values
    if (astParsed.whereClause) {
      const picklistValidation = await validatePicklistValuesWithAst(
        mainObject, astParsed, objectFields, orgId
      );
      messages.push(...picklistValidation.messages);
    }
    
    // Step 7: Validate aggregates
    messages.push(...validateAggregates(astParsed));

    // Step 8: Validate TYPEOF clauses
    if (astParsed.typeofClauses && astParsed.typeofClauses.length > 0) {
      for (const typeClause of astParsed.typeofClauses) {
        for (const branch of typeClause.whenBranches) {
          const typeMatch = findObjectMatch(branch.objectType, allObjects);
          if (!typeMatch.found) {
            messages.push({
              type: 'error',
              message: VALIDATION_ERROR_PATTERNS.TYPEOF_UNKNOWN_OBJECT.template(branch.objectType),
            });
            continue;
          }
          
          const subtypeFields = await getObjectFields(
            typeMatch.correctedName || branch.objectType, { orgId }
          );
          for (const field of branch.fields) {
            const fieldMatch = findFieldMatch(field, subtypeFields);
            if (!fieldMatch.found) {
              messages.push({
                type: 'error',
                message: VALIDATION_ERROR_PATTERNS.TYPEOF_FIELD_NOT_FOUND.template(
                  field,
                  branch.objectType
                ),
              });
            }
          }
        }
      }
    }

    // Step 9: Validate dot-notation in WHERE
    if (astParsed.whereClause) {
      const whereComparisons = extractWhereComparisons(astParsed.whereClause);
      const dotFields = whereComparisons.filter(c => c.field.includes('.')).map(c => c.field);
      const uniqueDotFields = [...new Set(dotFields)];
      
      for (const dotField of uniqueDotFields) {
        const lastDot = dotField.lastIndexOf('.');
        const fieldName = dotField.substring(lastDot + 1);
        const path = dotField.substring(0, lastDot);
        
        const validationResult = await validateParentLookup(mainObject, path, fieldName, orgId);

        if (!validationResult.isValid) {
          if (validationResult.suggestion) {
            // applyLookupCorrection now mutates AST in-place and returns message
            const message = applyLookupCorrection(
              rawQuery, path, fieldName,
              validationResult.suggestion, validationResult.error, 'WHERE'
            );
            messages.push(message);
            wasCorrected = true;
          } else {
            messages.push({
              type: 'error',
              message: validationResult.error || `Invalid field path in WHERE clause: ${dotField}`,
            });
          }
        }
      }

      // Step 10: Validate semi-joins
      const semiJoins = extractSemiJoins(astParsed.whereClause);
      const semiJoinValidation = await validateSemiJoinsFromAst(semiJoins, allObjects, orgId);
      messages.push(...semiJoinValidation.messages);
    }

    // Step 11: Check governor limits and apply corrections
    const governorResult = checkGovernorLimits(astParsed, mainObject);
    messages.push(...governorResult.messages);

    // Note: Governor limit changes still use string manipulation as they modify
    // the LIMIT clause which is straightforward and doesn't have the same risks
    // as field/object replacements. This could be migrated to AST in the future.
    if (governorResult.suggestedLimit !== undefined) {
      // Apply limit to the raw query AST
      rawQuery.limit = governorResult.suggestedLimit;
      wasCorrected = true;
    }

    // Regenerate SOQL from mutated AST if corrections were made
    if (wasCorrected) {
      correctedSoql = recomposeQuery(rawQuery);
    }

    const hasErrors = messages.some(m => m.type === 'error');
    const whereClauseMatch = soql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|\s*$)/i);

    return {
      isValid: !hasErrors,
      soql: correctedSoql,
      wasCorrected,
      messages,
      parsed: {
        mainObject,
        fields: fields.filter(f => !f.startsWith('(')),
        subqueries: subqueries.map(s => s.relationshipName),
        whereClause: whereClauseMatch?.[1],
        orderBy: astParsed.orderBy?.map(o => `${o.field} ${o.order || 'ASC'}`).join(', '),
        limit: governorResult.suggestedLimit ?? astParsed.limit,
      },
    };
  } catch (error) {
    log.error({ err: error }, 'Error validating SOQL');
    return {
      isValid: false,
      soql,
      wasCorrected: false,
      messages: [{
        type: 'error',
        message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
}

// === Enhanced Validation ===

/**
 * Enhanced validation with smart entity detection.
 */
export async function validateAndCorrectSoqlEnhanced(
  soql: string,
  orgId?: string
): Promise<EnhancedValidationResult> {
  const baseResult = await validateAndCorrectSoql(soql, orgId);
  const enhancedErrors: EnhancedValidationError[] = [];
  const hints: string[] = [];

  for (const msg of baseResult.messages) {
    if (msg.type === 'error' || msg.type === 'warning') {
      const enhanced = await analyzeValidationError(msg, soql, orgId);
      if (enhanced) {
        enhancedErrors.push(enhanced);
        if (enhanced.likelyEntityMisuse) {
          hints.push(enhanced.likelyEntityMisuse.explanation);
        }
      }
    }
  }

  return {
    ...baseResult,
    enhancedErrors,
    hints,
    correctedSoql: baseResult.wasCorrected ? baseResult.soql : undefined,
  };
}

/**
 * Analyze a validation error to detect potential entity misuse.
 */
async function analyzeValidationError(
  error: SoqlValidationMessage,
  _soql: string,
  orgId?: string
): Promise<EnhancedValidationError | null> {
  const message = error.message;

  // Pattern: Field "X" not found on Y
  const fieldNotFoundMatch = message.match(/Field "(\w+)" not found on (\w+)/);
  if (fieldNotFoundMatch) {
    const [, fieldName, objectName] = fieldNotFoundMatch;
    const classification = await classifyEntity(fieldName, { orgId });

    if (classification.type === 'company_name' || classification.type === 'person_name') {
      return {
        path: `${objectName}.${fieldName}`,
        errorType: 'hallucinated_entity',
        message: error.message,
        likelyEntityMisuse: {
          detectedEntityType: classification.type,
          suggestedPattern: `${objectName}.Name LIKE '${fieldName}%'`,
          explanation: getEntityMisuseExplanation(fieldName, classification.type, objectName),
        },
        suggestions: classification.suggestedPatterns.map(p => p.pattern),
      };
    }

    return {
      path: `${objectName}.${fieldName}`,
      errorType: 'invalid_field',
      message: error.message,
      suggestions: error.corrected ? [error.corrected] : [],
    };
  }

  // Pattern: Relationship "X" not found on Y
  const relNotFoundMatch = message.match(/Relationship "(\w+)" not found on (\w+)/);
  if (relNotFoundMatch) {
    const [, relName, objectName] = relNotFoundMatch;
    const classification = await classifyEntity(relName, { orgId });

    if (classification.type === 'company_name' || classification.type === 'person_name') {
      return {
        path: `${objectName}.${relName}`,
        errorType: 'hallucinated_entity',
        message: error.message,
        likelyEntityMisuse: {
          detectedEntityType: classification.type,
          suggestedPattern: `${objectName}.Name LIKE '${relName}%'`,
          explanation: getEntityMisuseExplanation(relName, classification.type, objectName),
        },
        suggestions: classification.suggestedPatterns.map(p => p.pattern),
      };
    }

    return {
      path: `${objectName}.${relName}`,
      errorType: 'invalid_relationship',
      message: error.message,
      suggestions: error.corrected ? [error.corrected] : [],
    };
  }

  // Pattern: Object "X" not found
  const objectNotFoundMatch = message.match(/Object "(\w+)" not found/);
  if (objectNotFoundMatch) {
    const [, objectName] = objectNotFoundMatch;
    return {
      path: objectName,
      errorType: 'invalid_object',
      message: error.message,
      suggestions: error.corrected ? [error.corrected] : [],
    };
  }

  return null;
}
