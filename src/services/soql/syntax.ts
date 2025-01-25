/**
 * SOQL Syntax and Picklist Validation
 *
 * Syntax checking, ID validation, picklist validation, and semi-join validation.
 */

import { getObjectFields, getPicklistValues, getObjectByApiName, type GraphObject, type GraphField } from '../neo4j/graph-service.js';
import { extractWhereComparisons, type ParsedSoqlAst, type SemiJoinInfo } from '../soql-ast-parser.js';
import type { SoqlValidationMessage } from '../../core/types.js';
import { createLogger } from '../../core/index.js';
import { findObjectMatch, findFieldMatch, findClosestPicklistValue } from './matching.js';

const log = createLogger('soql-syntax');

/**
 * Check for invalid SOQL syntax patterns.
 */
export function checkSyntax(soql: string): SoqlValidationMessage[] {
  const messages: SoqlValidationMessage[] = [];

  if (/\bIS\s+NOT\s+EMPTY\b/i.test(soql)) {
    messages.push({
      type: 'error',
      message: 'Invalid SOQL syntax: "IS NOT EMPTY" is not supported. Use "Id IN (SELECT ...)" instead.'
    });
  }

  if (/\bEXISTS\s*\(/i.test(soql)) {
    messages.push({
      type: 'error',
      message: 'Invalid SOQL syntax: "EXISTS" is not supported. Use "Id IN (SELECT ...)" instead.'
    });
  }

  if (/\b(AND|OR)\s*\(\s*SELECT\b/i.test(soql)) {
    messages.push({
      type: 'error',
      message: 'Invalid SOQL syntax: Subqueries cannot be used as boolean conditions. ' +
               'Use "Id IN (SELECT ...)" or "Id NOT IN (SELECT ...)" instead.',
    });
  }

  // Check for unsupported set operators
  if (/\b(UNION|EXCEPT|INTERSECT)\b/i.test(soql)) {
    messages.push({
      type: 'error',
      message: 'Invalid SOQL syntax: UNION, EXCEPT, and INTERSECT are not supported in SOQL. Use logical operators (AND/OR) or semi-joins (IN/NOT IN).'
    });
  }

  // Check for HAVING without GROUP BY
  if (/\bHAVING\b/i.test(soql) && !/\bGROUP\s+BY\b/i.test(soql)) {
    messages.push({
      type: 'error',
      message: 'Invalid SOQL syntax: HAVING clause is only allowed with GROUP BY.'
    });
  }

  // Check for AS keyword (not supported in SOQL, aliases are implicit)
  if (/\bAS\b/i.test(soql)) {
    messages.push({
      type: 'error',
      message: 'Invalid SOQL syntax: "AS" keyword is not supported. For aggregates, use a space (e.g., "SELECT COUNT(Id) myCount"). Standard fields cannot be aliased.'
    });
  }

  // Check for Bind Variables (e.g., :myVar)
  if (/:[a-zA-Z]/.test(soql)) {
    messages.push({
      type: 'error',
      message: 'Invalid SOQL syntax: Bind variables (e.g., :variable) are not supported. Use literal values.'
    });
  }

  // Check for *Id LIKE patterns (always wrong)
  messages.push(...checkIdFieldLikePatterns(soql));

  return messages;
}

/**
 * Check for invalid patterns where ID fields are used with LIKE operator.
 * 
 * Patterns like `OwnerId LIKE 'John Doe%'` are always wrong because:
 * - ID fields contain 15/18 character Salesforce IDs, not names
 * - Names should be looked up via relationship traversal: `Owner.Name LIKE 'John Doe%'`
 * 
 * Common incorrect patterns:
 * - OwnerId LIKE 'name' → Should be: Owner.Name LIKE 'name'
 * - ContactId LIKE 'name' → Should be: Contact.Name LIKE 'name'
 * - AccountId LIKE 'name' → Should be: Account.Name LIKE 'name'
 */
export function checkIdFieldLikePatterns(soql: string): SoqlValidationMessage[] {
  const messages: SoqlValidationMessage[] = [];
  
  // Match patterns like: FieldId LIKE 'value' or FieldId LIKE '%value%'
  // Excludes RecordId, RecordTypeId which are valid to use with LIKE patterns like '005%'
  const idLikePattern = /\b(\w+Id)\s+LIKE\s+'([^']+)'/gi;
  
  // Fields that should NOT trigger this rule (legitimate ID pattern matching)
  const excludedFields = new Set([
    'recordid',
    'recordtypeid',
  ]);
  
  // Map of ID field suffixes to their relationship names
  const idToRelationshipMap: Record<string, string> = {
    'ownerid': 'Owner',
    'contactid': 'Contact',
    'accountid': 'Account',
    'createdbyid': 'CreatedBy',
    'lastmodifiedbyid': 'LastModifiedBy',
    'userid': 'User',
    'parentid': 'Parent',
    'whatid': 'What',
    'whoid': 'Who',
  };
  
  let match;
  while ((match = idLikePattern.exec(soql)) !== null) {
    const fieldName = match[1];
    const fieldLower = fieldName.toLowerCase();
    const likeValue = match[2];
    
    // Skip excluded fields
    if (excludedFields.has(fieldLower)) {
      continue;
    }
    
    // Skip if the LIKE value looks like an ID pattern (e.g., '005%', '001xyz%')
    // Valid ID patterns start with 3-character prefix and may have wildcards
    const isIdPattern = /^[0][0-9a-zA-Z]{2}/.test(likeValue);
    if (isIdPattern) {
      continue;
    }
    
    // Determine the correct relationship name
    let relationshipName = idToRelationshipMap[fieldLower];
    
    // If not in map, derive from field name (e.g., MyFieldId -> MyField)
    if (!relationshipName && fieldLower.endsWith('id')) {
      relationshipName = fieldName.slice(0, -2); // Remove 'Id' suffix
    }
    
    if (relationshipName) {
      messages.push({
        type: 'error',
        message: `Invalid LIKE on ID field "${fieldName}". ID fields contain Salesforce IDs (e.g., "005..."), not names. ` +
                 `Use relationship traversal: ${relationshipName}.Name LIKE '${likeValue}'`,
        original: `${fieldName} LIKE '${likeValue}'`,
        corrected: `${relationshipName}.Name LIKE '${likeValue}'`,
      });
    }
  }
  
  return messages;
}

/**
 * Check for suspicious ID literals or placeholders.
 */
export function checkSuspiciousIds(soql: string): SoqlValidationMessage[] {
  const messages: SoqlValidationMessage[] = [];
  const suspiciousIdRegex = /'([0][0][1356][^']*)'/g;
  
  let match;
  while ((match = suspiciousIdRegex.exec(soql)) !== null) {
    messages.push({
      type: 'error',
      message: `Found ID literal "${match[1]}". Do NOT guess IDs or use placeholders. Use Name fields (e.g. Owner.Name LIKE '...') or subqueries.`,
    });
  }
  
  return messages;
}

/**
 * Validate semi-joins extracted from AST.
 */
export async function validateSemiJoinsFromAst(
  semiJoins: SemiJoinInfo[],
  allObjects: GraphObject[],
  orgId?: string
): Promise<{ messages: SoqlValidationMessage[] }> {
  const messages: SoqlValidationMessage[] = [];

  for (const sj of semiJoins) {
    let objectMatch = findObjectMatch(sj.subquery.sObject, allObjects);

    // Fallback: Try direct DB lookup if not found in pre-fetched list
    if (!objectMatch.found) {
      try {
        const directObj = await getObjectByApiName(sj.subquery.sObject, { orgId });
        if (directObj) {
          objectMatch = { found: true, correctedName: directObj.apiName };
        }
      } catch (err) {
        log.warn({ err, object: sj.subquery.sObject }, 'Failed to lookup object during semi-join validation');
      }
    }

    if (!objectMatch.found) {
      messages.push({
        type: 'error',
        message: `Object "${sj.subquery.sObject}" not found in semi-join subquery`,
      });
      continue;
    }

    const verifiedObjectName = objectMatch.correctedName || sj.subquery.sObject;

    try {
      const fields = await getObjectFields(verifiedObjectName, { orgId });
      const fieldMatch = findFieldMatch(sj.subquery.field, fields);

      if (!fieldMatch.found) {
        let msg = `Field "${sj.subquery.field}" not found on "${verifiedObjectName}" in semi-join subquery.`;
        
        if (fieldMatch.suggestion) {
          msg += ` Did you mean "${fieldMatch.suggestion}"?`;
        } else {
          const likelyLookups = fields.filter(f => f.apiName.endsWith('Id')).map(f => f.apiName).slice(0, 5);
          if (likelyLookups.length > 0) {
            msg += ` Available lookup fields: ${likelyLookups.join(', ')}`;
          }
        }

        messages.push({
          type: 'error',
          message: msg,
        });
      }
    } catch (error) {
      log.debug({ err: error, semiJoin: sj }, 'Could not validate semi-join');
    }
  }

  return { messages };
}

/**
 * AST-based picklist validation.
 */
export async function validatePicklistValuesWithAst(
  objectApiName: string,
  parsedAst: ParsedSoqlAst,
  objectFields: GraphField[],
  orgId?: string
): Promise<{ messages: SoqlValidationMessage[] }> {
  const messages: SoqlValidationMessage[] = [];
  const comparisons = extractWhereComparisons(parsedAst.whereClause);
  
  if (comparisons.length === 0) {
    return { messages };
  }

  const picklistFields = objectFields.filter(
    f => f.type === 'picklist' || f.type === 'multipicklist'
  );
  const picklistFieldNames = new Set(picklistFields.map(f => f.apiName.toLowerCase()));

  for (const cmp of comparisons) {
    if (cmp.isSubquery || cmp.value === null) continue;

    const fieldParts = cmp.field.split('.');
    const fieldName = fieldParts[fieldParts.length - 1];
    const fieldLower = fieldName.toLowerCase();

    if (!picklistFieldNames.has(fieldLower)) continue;

    const fieldObj = picklistFields.find(f => f.apiName.toLowerCase() === fieldLower);
    if (!fieldObj) continue;

    const valuesToCheck: string[] = [];
    if ((cmp.operator === 'INCLUDES' || cmp.operator === 'EXCLUDES') && 
        typeof cmp.value === 'string') {
      valuesToCheck.push(...cmp.value.split(';').map(v => v.trim()));
    } else {
      valuesToCheck.push(String(cmp.value));
    }

    try {
      const picklistValues = await getPicklistValues(objectApiName, fieldObj.apiName, orgId);
      const activeValues = picklistValues.filter(v => v.active).map(v => v.value);

      for (const value of valuesToCheck) {
        const valueExists = activeValues.some(
          v => v.toLowerCase() === value.toLowerCase()
        );

        if (!valueExists) {
          const closestMatch = findClosestPicklistValue(value, activeValues);
          
          if (closestMatch) {
            messages.push({
              type: 'error',
              message: `Invalid picklist value "${value}" for ${fieldObj.apiName}. Did you mean "${closestMatch}"?`,
              original: value,
              corrected: closestMatch,
            });
          } else {
            messages.push({
              type: 'error',
              message: `Invalid picklist value "${value}" for ${fieldObj.apiName}. Valid: ${activeValues.slice(0, 5).join(', ')}${activeValues.length > 5 ? '...' : ''}`,
            });
          }
        }
      }
    } catch (error) {
      log.debug({ err: error, field: fieldObj.apiName }, 'Could not fetch picklist values for validation');
    }
  }

  return { messages };
}
