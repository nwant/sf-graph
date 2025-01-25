/**
 * SOQL Matching Utilities
 *
 * Object, field, and relationship matching with fuzzy suggestions.
 */

import type { GraphObject, GraphField } from '../neo4j/graph-service.js';
import { findClosestMatch, levenshteinDistance } from './utils.js';

// === Types ===

export interface MatchResult {
  found: boolean;
  suggestion?: string;
  correctedName?: string;
}

export interface RelationshipMatchResult {
  found: boolean;
  relationship?: { targetObject: string; relationshipName?: string };
  suggestion?: string;
  suggestedTarget?: string;
}

// === Object/Field Matching ===

/**
 * Find a matching object, with fuzzy matching for corrections.
 */
export function findObjectMatch(name: string, allObjects: GraphObject[]): MatchResult {
  const nameLower = name.toLowerCase();

  // Exact match (case-insensitive)
  const exact = allObjects.find(o => o.apiName.toLowerCase() === nameLower);
  if (exact) {
    return { found: true, correctedName: exact.apiName };
  }

  // No match - try fuzzy
  const suggestion = findClosestMatch(name, allObjects.map(o => o.apiName));
  return { found: false, suggestion: suggestion || undefined };
}

/**
 * Find a matching field, with fuzzy matching for corrections.
 */
export function findFieldMatch(name: string, allFields: GraphField[]): MatchResult {
  const nameLower = name.toLowerCase();

  // Exact match (case-insensitive)
  const exact = allFields.find(f => f.apiName.toLowerCase() === nameLower);
  if (exact) {
    return { found: true, correctedName: exact.apiName };
  }

  // Check by label
  const byLabel = allFields.find(f => f.label?.toLowerCase() === nameLower);
  if (byLabel) {
    return { found: true, correctedName: byLabel.apiName };
  }

  // No match - try fuzzy
  const suggestion = findClosestMatch(name, allFields.map(f => f.apiName));
  return { found: false, suggestion: suggestion || undefined };
}

/**
 * Find a matching relationship with smart suggestions.
 */
export function findRelationshipMatch(
  part: string,
  relationships: Array<{ relationshipName?: string; targetObject: string; direction: string }>
): RelationshipMatchResult {
  const partLower = part.toLowerCase();
  const outgoingRels = relationships.filter(r => r.direction === 'outgoing');

  // 1. Exact match on relationship name
  const exactMatch = outgoingRels.find(
    r => r.relationshipName?.toLowerCase() === partLower
  );
  if (exactMatch && exactMatch.relationshipName) {
    return {
      found: true,
      relationship: { targetObject: exactMatch.targetObject, relationshipName: exactMatch.relationshipName },
    };
  }

  // 2. Match by target object name
  const targetMatch = outgoingRels.find(
    r => r.targetObject?.toLowerCase() === partLower
  );
  if (targetMatch) {
    return {
      found: true,
      relationship: { targetObject: targetMatch.targetObject, relationshipName: targetMatch.relationshipName },
    };
  }

  // 3. No exact match - find smart suggestions
  let bestSuggestion: string | null = null;
  let bestDistance = Infinity;
  let suggestedTarget: string | undefined;

  for (const rel of outgoingRels) {
    if (!rel.relationshipName) continue;
    const distance = levenshteinDistance(partLower, rel.relationshipName.toLowerCase());
    if (distance < bestDistance && distance <= 3) {
      bestDistance = distance;
      bestSuggestion = rel.relationshipName;
      suggestedTarget = rel.targetObject;
    }
  }

  // Also check target object names for fuzzy match
  for (const rel of outgoingRels) {
    if (!rel.targetObject) continue;
    const distance = levenshteinDistance(partLower, rel.targetObject.toLowerCase());
    if (distance < bestDistance && distance <= 3) {
      bestDistance = distance;
      bestSuggestion = rel.relationshipName || rel.targetObject;
      suggestedTarget = rel.targetObject;
    }
  }

  // Check for startsWith match
  if (!bestSuggestion) {
    const startsWithRel = outgoingRels.find(
      r => r.relationshipName?.toLowerCase().startsWith(partLower)
    );
    if (startsWithRel && startsWithRel.relationshipName) {
      bestSuggestion = startsWithRel.relationshipName;
      suggestedTarget = startsWithRel.targetObject;
    }
  }

  // Check for contains match
  if (!bestSuggestion) {
    const containsRel = outgoingRels.find(
      r => r.relationshipName?.toLowerCase().includes(partLower)
    );
    if (containsRel && containsRel.relationshipName) {
      bestSuggestion = containsRel.relationshipName;
      suggestedTarget = containsRel.targetObject;
    }
  }

  return {
    found: false,
    suggestion: bestSuggestion || undefined,
    suggestedTarget,
  };
}

/**
 * Find the closest picklist value match.
 */
export function findClosestPicklistValue(input: string, values: string[]): string | null {
  const inputLower = input.toLowerCase();

  // Exact match (case-insensitive)
  const exact = values.find(v => v.toLowerCase() === inputLower);
  if (exact) return exact;

  // Starts with match
  const startsWith = values.find(v => v.toLowerCase().startsWith(inputLower));
  if (startsWith) return startsWith;

  // Contains match
  const contains = values.find(v => v.toLowerCase().includes(inputLower));
  if (contains) return contains;

  // Levenshtein distance for close matches
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of values) {
    const distance = levenshteinDistance(inputLower, candidate.toLowerCase());
    if (distance < bestDistance && distance <= 3) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}
