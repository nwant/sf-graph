/**
 * Salesforce condition patterns and extraction helpers
 * This file contains patterns and utilities for extraction conditions from natural language queries
 */

interface ConditionPattern {
  pattern: RegExp;
  objectName: string | null;
  field: string;
  operator: string;
  valueExtractor: (matches: RegExpMatchArray) => string | number | boolean | null;
}

interface ImpliedConditionPattern {
  pattern: RegExp;
  objectName: string;
  field: string;
  operator: string;
  value: string | number | boolean | null;
  valueType: string;
}

interface LocationConditionConfig {
  field: string;
  operator: string;
}

export interface Condition {
  field: string;
  operator: string;
  value: string | number | boolean | null;
  valueType: string;
  source: string;
}

/**
 * Get multiplier for currency values
 * @param {string} suffix - The suffix (k, thousand, m, million, etc.)
 * @returns {number} - The multiplier value
 */
function getMultiplier(suffix: string): number {
  const normalized = suffix.toLowerCase().trim();

  if (normalized === 'k' || normalized === 'thousand') {
    return 1000;
  }

  if (normalized === 'm' || normalized === 'million') {
    return 1000000;
  }

  if (normalized === 'b' || normalized === 'billion') {
    return 1000000000;
  }

  // Handle "bucks" or "dollars" or other currency terms
  if (normalized === 'bucks' || normalized === 'dollars') {
    return 1;
  }

  return 1;
}

/**
 * Get date value for Salesforce date literals
 * @param {string} term - The date term (TODAY, YESTERDAY, etc.)
 * @returns {string} - The Salesforce date literal
 */
function getDateValue(term: string): string {
  const normalized = term.toUpperCase();

  // Map common terms to Salesforce date literals
  const dateMap: Record<string, string> = {
    TODAY: 'TODAY',
    YESTERDAY: 'YESTERDAY',
    'THIS WEEK': 'THIS_WEEK',
    'LAST WEEK': 'LAST_WEEK',
    'THIS MONTH': 'THIS_MONTH',
    'LAST MONTH': 'LAST_MONTH',
    'THIS YEAR': 'THIS_YEAR',
    'LAST YEAR': 'LAST_YEAR',
  };

  return dateMap[normalized] || normalized;
}

/**
 * Common condition patterns by object
 * Maps natural language patterns to Salesforce field conditions
 * Format: { pattern: RegExp, objectName: string, field: string, operator: string, valueExtractor: Function }
 */
export const conditionPatterns: ConditionPattern[] = [
  // Account location patterns
  {
    pattern: /in\s+([A-Za-z\s]+)$/i,
    objectName: 'Account',
    field: 'BillingState',
    operator: '=',
    valueExtractor: (matches) => matches[1].trim(),
  },
  {
    pattern: /located\s+in\s+([A-Za-z\s]+)$/i,
    objectName: 'Account',
    field: 'BillingState',
    operator: '=',
    valueExtractor: (matches) => matches[1].trim(),
  },
  {
    pattern: /from\s+([A-Za-z\s]+)$/i,
    objectName: 'Account',
    field: 'BillingState',
    operator: '=',
    valueExtractor: (matches) => matches[1].trim(),
  },
  {
    pattern: /based\s+in\s+([A-Za-z\s]+)$/i,
    objectName: 'Account',
    field: 'BillingState',
    operator: '=',
    valueExtractor: (matches) => matches[1].trim(),
  },

  // Account employee count patterns
  {
    pattern: /(more than|greater than|over|above)\s+(\d+)\s+(employees|employee|staff|people)/i,
    objectName: 'Account',
    field: 'NumberOfEmployees',
    operator: '>',
    valueExtractor: (matches) => parseInt(matches[2], 10),
  },
  {
    pattern: /(less than|fewer than|under|below)\s+(\d+)\s+(employees|employee|staff|people)/i,
    objectName: 'Account',
    field: 'NumberOfEmployees',
    operator: '<',
    valueExtractor: (matches) => parseInt(matches[2], 10),
  },
  {
    pattern: /with\s+(\d+)\s+(or more|or greater)\s+(employees|employee|staff|people)/i,
    objectName: 'Account',
    field: 'NumberOfEmployees',
    operator: '>=',
    valueExtractor: (matches) => parseInt(matches[1], 10),
  },

  // Account revenue patterns
  {
    pattern:
      /(revenue|annual revenue|sales)\s+(greater than|more than|over|above)\s+(\d+)(\s*k|\s*thousand|\s*m|\s*million|\s*b|\s*billion)?/i,
    objectName: 'Account',
    field: 'AnnualRevenue',
    operator: '>',
    valueExtractor: (matches) => {
      const baseValue = parseInt(matches[3], 10);
      const multiplier = matches[4] ? getMultiplier(matches[4].trim()) : 1;
      return baseValue * multiplier;
    },
  },
  {
    pattern:
      /(revenue|annual revenue|sales)\s+(less than|under|below)\s+(\d+)(\s*k|\s*thousand|\s*m|\s*million|\s*b|\s*billion)?/i,
    objectName: 'Account',
    field: 'AnnualRevenue',
    operator: '<',
    valueExtractor: (matches) => {
      const baseValue = parseInt(matches[3], 10);
      const multiplier = matches[4] ? getMultiplier(matches[4].trim()) : 1;
      return baseValue * multiplier;
    },
  },

  // Contact name patterns
  {
    pattern: /(last name|lastname)\s+(is|=|equals)\s+([A-Za-z\s]+)$/i,
    objectName: 'Contact',
    field: 'LastName',
    operator: '=',
    valueExtractor: (matches) => matches[3].trim(),
  },
  {
    pattern: /(first name|firstname)\s+(is|=|equals)\s+([A-Za-z\s]+)$/i,
    objectName: 'Contact',
    field: 'FirstName',
    operator: '=',
    valueExtractor: (matches) => matches[3].trim(),
  },
  {
    pattern: /whose\s+(last name|lastname)\s+(is|=|equals)\s+([A-Za-z\s]+)$/i,
    objectName: 'Contact',
    field: 'LastName',
    operator: '=',
    valueExtractor: (matches) => matches[3].trim(),
  },
  {
    pattern: /where\s+(last name|lastname)\s+(is|=|equals)\s+([A-Za-z\s]+)$/i,
    objectName: 'Contact',
    field: 'LastName',
    operator: '=',
    valueExtractor: (matches) => matches[3].trim(),
  },

  // Opportunity amount patterns
  {
    pattern:
      /(amount|value|deal size|revenue|worth|price)\s+(greater than|more than|over|above)\s+(\d+)(\s*k|\s*thousand|\s*m|\s*million|\s*b|\s*billion)?/i,
    objectName: 'Opportunity',
    field: 'Amount',
    operator: '>',
    valueExtractor: (matches) => {
      const baseValue = parseInt(matches[3], 10);
      const multiplier = matches[4] ? getMultiplier(matches[4].trim()) : 1;
      return baseValue * multiplier;
    },
  },
  {
    pattern:
      /(amount|value|deal size|revenue|worth|price)\s+(less than|under|below)\s+(\d+)(\s*k|\s*thousand|\s*m|\s*million|\s*b|\s*billion)?/i,
    objectName: 'Opportunity',
    field: 'Amount',
    operator: '<',
    valueExtractor: (matches) => {
      const baseValue = parseInt(matches[3], 10);
      const multiplier = matches[4] ? getMultiplier(matches[4].trim()) : 1;
      return baseValue * multiplier;
    },
  },
  {
    pattern:
      /worth\s+(over|more than)\s+(\d+)(\s*k|\s*thousand|\s*m|\s*million|\s*b|\s*billion|\s*bucks|\s*dollars)?/i,
    objectName: 'Opportunity',
    field: 'Amount',
    operator: '>',
    valueExtractor: (matches) => {
      const baseValue = parseInt(matches[2], 10);
      const multiplier = matches[3] ? getMultiplier(matches[3].trim()) : 1;
      return baseValue * multiplier;
    },
  },

  // Date patterns
  {
    pattern:
      /created\s+(yesterday|today|this week|this month|this year|last week|last month|last year)/i,
    objectName: null, // Applies to any object
    field: 'CreatedDate',
    operator: '=',
    valueExtractor: (matches) => getDateValue(matches[1].trim().toUpperCase()),
  },
  {
    pattern:
      /created\s+(in the last|within the last|in the past|within the past)\s+(\d+)\s+(days?|weeks?|months?|years?)/i,
    objectName: null, // Applies to any object
    field: 'CreatedDate',
    operator: '>=',
    valueExtractor: (matches) => {
      const number = parseInt(matches[2], 10);
      const unit = matches[3].toLowerCase().startsWith('day')
        ? 'DAY'
        : matches[3].toLowerCase().startsWith('week')
          ? 'WEEK'
          : matches[3].toLowerCase().startsWith('month')
            ? 'MONTH'
            : 'YEAR';
      return `LAST_N_${unit}S:${number}`;
    },
  },
  {
    pattern:
      /modified\s+(yesterday|today|this week|this month|this year|last week|last month|last year)/i,
    objectName: null, // Applies to any object
    field: 'LastModifiedDate',
    operator: '=',
    valueExtractor: (matches) => getDateValue(matches[1].trim().toUpperCase()),
  },
];

/**
 * Implied condition patterns
 * Maps natural language patterns to implied conditions
 * Format: { pattern: RegExp, objectName: string, field: string, operator: string, value: any, valueType: string }
 */
export const impliedConditionPatterns: ImpliedConditionPattern[] = [
  // Active status
  {
    pattern: /\b(active)\b/i,
    objectName: 'Account',
    field: 'IsActive',
    operator: '=',
    value: true,
    valueType: 'boolean',
  },
  {
    pattern: /\b(inactive|not active)\b/i,
    objectName: 'Account',
    field: 'IsActive',
    operator: '=',
    value: false,
    valueType: 'boolean',
  },

  // Open/Closed status for Cases
  {
    pattern: /\b(open)\b/i,
    objectName: 'Case',
    field: 'IsClosed',
    operator: '=',
    value: false,
    valueType: 'boolean',
  },
  {
    pattern: /\b(closed)\b/i,
    objectName: 'Case',
    field: 'IsClosed',
    operator: '=',
    value: true,
    valueType: 'boolean',
  },

  // Won/Lost status for Opportunities
  {
    pattern: /\b(won|winning|successful)\b/i,
    objectName: 'Opportunity',
    field: 'IsWon',
    operator: '=',
    value: true,
    valueType: 'boolean',
  },
  {
    pattern: /\b(lost|unsuccessful)\b/i,
    objectName: 'Opportunity',
    field: 'IsWon',
    operator: '=',
    value: false,
    valueType: 'boolean',
  },

  // Converted status for Leads
  {
    pattern: /\b(converted)\b/i,
    objectName: 'Lead',
    field: 'IsConverted',
    operator: '=',
    value: true,
    valueType: 'boolean',
  },
  {
    pattern: /\b(not converted|unconverted)\b/i,
    objectName: 'Lead',
    field: 'IsConverted',
    operator: '=',
    value: false,
    valueType: 'boolean',
  },

  // Big/Large/Small for Opportunities
  {
    pattern: /\b(big|large)\b/i,
    objectName: 'Opportunity',
    field: 'Amount',
    operator: '>',
    value: 100000,
    valueType: 'number',
  },
  {
    pattern: /\b(small)\b/i,
    objectName: 'Opportunity',
    field: 'Amount',
    operator: '<',
    value: 10000,
    valueType: 'number',
  },
];

/**
 * Location-based condition patterns
 * Maps location terms to field conditions for different objects
 */
export const locationConditionMap: Record<string, LocationConditionConfig> = {
  Account: {
    field: 'BillingState',
    operator: '=',
  },
  Contact: {
    field: 'MailingState',
    operator: '=',
  },
  Lead: {
    field: 'State',
    operator: '=',
  },
};

/**
 * Determine the type of a value
 * @param {any} value - The value to check
 * @returns {string} - The value type
 */
function determineValueType(value: unknown): string {
  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (typeof value === 'string') {
    if (!isNaN(Number(value))) {
      return 'number';
    }

    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      return 'boolean';
    }

    if (value.includes('_')) {
      return 'date';
    }
  }

  return 'string';
}

/**
 * Extract conditions from a query using patterns
 * @param {string} query - The natural language query
 * @param {string} objectName - The API name of the Salesforce object
 * @returns {Array} - Array of extracted conditions
 */
export function extractConditionsFromPatterns(query: string, objectName: string): Condition[] {
  if (!query) return [];

  const conditions: Condition[] = [];

  // Check each pattern
  for (const pattern of conditionPatterns) {
    // Skip if pattern is object-specific and doesn't match the current object
    if (pattern.objectName && pattern.objectName !== objectName) continue;

    // Check if pattern matches
    const matches = query.match(pattern.pattern);
    if (matches) {
      try {
        const value = pattern.valueExtractor(matches);
        conditions.push({
          field: pattern.field,
          operator: pattern.operator,
          value: value,
          valueType: determineValueType(value),
          source: 'pattern',
        });
      } catch (error) {
        console.warn(`Error extracting value for pattern ${pattern.pattern}:`, error);
      }
    }
  }

  return conditions;
}

/**
 * Extract implied conditions from a query
 * @param {string} query - The natural language query
 * @param {string} objectName - The API name of the Salesforce object
 * @returns {Array} - Array of extracted implied conditions
 */
export function extractImpliedConditions(query: string, objectName: string): Condition[] {
  if (!query) return [];

  const conditions: Condition[] = [];

  // Check each implied condition pattern
  for (const pattern of impliedConditionPatterns) {
    // Skip if pattern is object-specific and doesn't match the current object
    if (pattern.objectName && pattern.objectName !== objectName) continue;

    // Check if pattern matches
    if (pattern.pattern.test(query)) {
      conditions.push({
        field: pattern.field,
        operator: pattern.operator,
        value: pattern.value,
        valueType: pattern.valueType,
        source: 'implied',
      });
    }
  }

  return conditions;
}

/**
 * Extract location-based conditions from a query
 * @param {string} query - The natural language query
 * @param {string} objectName - The API name of the Salesforce object
 * @returns {Array} - Array of extracted location conditions
 */
export function extractLocationConditions(query: string, objectName: string): Condition[] {
  if (!query || !objectName || !locationConditionMap[objectName]) return [];

  const conditions: Condition[] = [];
  const locationConfig = locationConditionMap[objectName];

  // Common location patterns
  const locationPatterns = [
    { pattern: /\bin\s+([A-Za-z\s]+)$/i, group: 1 },
    { pattern: /\blocated\s+in\s+([A-Za-z\s]+)$/i, group: 1 },
    { pattern: /\bfrom\s+([A-Za-z\s]+)$/i, group: 1 },
    { pattern: /\bbased\s+in\s+([A-Za-z\s]+)$/i, group: 1 },
  ];

  // Check each location pattern
  for (const pattern of locationPatterns) {
    const matches = query.match(pattern.pattern);
    if (matches && matches[pattern.group]) {
      const location = matches[pattern.group].trim();

      // Skip if location is too short or generic
      if (location.length < 2 || ['the', 'a', 'an'].includes(location.toLowerCase())) {
        continue;
      }

      conditions.push({
        field: locationConfig.field,
        operator: locationConfig.operator,
        value: location,
        valueType: 'string',
        source: 'location',
      });

      // Only use the first valid location match
      break;
    }
  }

  return conditions;
}
