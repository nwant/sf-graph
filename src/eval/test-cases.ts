/**
 * Test cases for evaluating natural language to SOQL generation
 * Each test case includes:
 * - description: Description of the test case
 * - query: Natural language query
 * - expectedObject: Expected Salesforce object
 * - expectedFields: Expected fields in the SOQL query
 * - expectedConditions: Expected conditions in the WHERE clause
 * - expectedOrderBy: Expected ORDER BY clause
 * - expectedLimit: Expected LIMIT clause
 * - difficulty: Difficulty level (easy, medium, hard)
 * - category: Category of the test case (basic, complex, edge case)
 */

export interface TestCondition {
  field: string;
  operator: string;
  value: string | number | boolean;
}

export interface ExpectedOrderBy {
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface TestCase {
  description: string;
  query: string;
  expectedObject: string | null;
  expectedFields: string[];
  expectedConditions: TestCondition[];
  expectedOrderBy: ExpectedOrderBy | ExpectedOrderBy[] | null;
  expectedLimit: number | null;
  difficulty: 'easy' | 'medium' | 'hard';
  category: 'basic' | 'complex' | 'edge case';
}

export const testCases: TestCase[] = [
  // Basic queries
  {
    description: 'Simple Account query',
    query: 'Show me all accounts',
    expectedObject: 'Account',
    expectedFields: ['Id', 'Name'],
    expectedConditions: [],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'easy',
    category: 'basic',
  },
  {
    description: 'Account query with condition',
    query: 'Show me accounts in California',
    expectedObject: 'Account',
    expectedFields: ['Id', 'Name'],
    expectedConditions: [{ field: 'BillingState', operator: '=', value: 'California' }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'easy',
    category: 'basic',
  },
  {
    description: 'Contact query with name condition',
    query: 'Find contacts where the last name is Smith',
    expectedObject: 'Contact',
    expectedFields: ['Id', 'FirstName', 'LastName'],
    expectedConditions: [{ field: 'LastName', operator: '=', value: 'Smith' }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'easy',
    category: 'basic',
  },

  // Queries with sorting and limiting
  {
    description: 'Opportunity query with sorting',
    query: 'Get opportunities sorted by amount',
    expectedObject: 'Opportunity',
    expectedFields: ['Id', 'Name', 'Amount'],
    expectedConditions: [],
    expectedOrderBy: { field: 'Amount', direction: 'DESC' },
    expectedLimit: null,
    difficulty: 'medium',
    category: 'basic',
  },
  {
    description: 'Opportunity query with limit',
    query: 'Show me the top 5 opportunities',
    expectedObject: 'Opportunity',
    expectedFields: ['Id', 'Name', 'Amount'],
    expectedConditions: [],
    expectedOrderBy: { field: 'Amount', direction: 'DESC' },
    expectedLimit: 5,
    difficulty: 'medium',
    category: 'basic',
  },

  // Complex queries with multiple conditions
  {
    description: 'Account query with multiple conditions',
    query: 'Find accounts in California with more than 100 employees',
    expectedObject: 'Account',
    expectedFields: ['Id', 'Name', 'BillingState', 'NumberOfEmployees'],
    expectedConditions: [
      { field: 'BillingState', operator: '=', value: 'California' },
      { field: 'NumberOfEmployees', operator: '>', value: 100 },
    ],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'medium',
    category: 'complex',
  },
  {
    description: 'Opportunity query with date and amount conditions',
    query: 'Show opportunities created this year with amount greater than 50000',
    expectedObject: 'Opportunity',
    expectedFields: ['Id', 'Name', 'Amount', 'CreatedDate'],
    expectedConditions: [
      { field: 'CreatedDate', operator: '>=', value: 'THIS_YEAR' },
      { field: 'Amount', operator: '>', value: 50000 },
    ],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'hard',
    category: 'complex',
  },

  // Queries with specific field selection
  {
    description: 'Account query with specific fields',
    query: 'Show me account names, phone numbers, and websites',
    expectedObject: 'Account',
    expectedFields: ['Id', 'Name', 'Phone', 'Website'],
    expectedConditions: [],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'medium',
    category: 'basic',
  },

  // Edge cases and challenging queries
  {
    description: 'Query with ambiguous object reference',
    query: 'Show me records created yesterday',
    expectedObject: null, // Should identify that object is ambiguous
    expectedFields: [],
    expectedConditions: [{ field: 'CreatedDate', operator: '=', value: 'YESTERDAY' }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'hard',
    category: 'edge case',
  },
  {
    description: 'Query with implied conditions',
    query: 'Show me active accounts',
    expectedObject: 'Account',
    expectedFields: ['Id', 'Name'],
    expectedConditions: [{ field: 'IsActive', operator: '=', value: true }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'medium',
    category: 'edge case',
  },
  {
    description: 'Query with complex sorting',
    query: 'Show me opportunities sorted by amount descending and then by close date',
    expectedObject: 'Opportunity',
    expectedFields: ['Id', 'Name', 'Amount', 'CloseDate'],
    expectedConditions: [],
    expectedOrderBy: [
      { field: 'Amount', direction: 'DESC' },
      { field: 'CloseDate', direction: 'ASC' },
    ],
    expectedLimit: null,
    difficulty: 'hard',
    category: 'complex',
  },

  // Queries with different phrasings
  {
    description: 'Alternative phrasing for account query',
    query: 'I need to see accounts located in California',
    expectedObject: 'Account',
    expectedFields: ['Id', 'Name'],
    expectedConditions: [{ field: 'BillingState', operator: '=', value: 'California' }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'medium',
    category: 'basic',
  },
  {
    description: 'Conversational query',
    query: 'Can you please show me the contacts whose last name is Johnson?',
    expectedObject: 'Contact',
    expectedFields: ['Id', 'FirstName', 'LastName'],
    expectedConditions: [{ field: 'LastName', operator: '=', value: 'Johnson' }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'medium',
    category: 'basic',
  },

  // Queries with typos or informal language
  {
    description: 'Query with typo',
    query: 'Show me all acocunts in New York',
    expectedObject: 'Account',
    expectedFields: ['Id', 'Name'],
    expectedConditions: [{ field: 'BillingState', operator: '=', value: 'New York' }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'hard',
    category: 'edge case',
  },
  {
    description: 'Query with informal language',
    query: 'Gimme the big opportunities worth over a million bucks',
    expectedObject: 'Opportunity',
    expectedFields: ['Id', 'Name', 'Amount'],
    expectedConditions: [{ field: 'Amount', operator: '>', value: 1000000 }],
    expectedOrderBy: null,
    expectedLimit: null,
    difficulty: 'hard',
    category: 'edge case',
  },
];

/**
 * Get test cases by category
 * @param category - Category to filter by
 * @returns Filtered test cases
 */
export function getTestCasesByCategory(category: string): TestCase[] {
  return testCases.filter((testCase) => testCase.category === category);
}

/**
 * Get test cases by difficulty
 * @param difficulty - Difficulty level to filter by
 * @returns Filtered test cases
 */
export function getTestCasesByDifficulty(difficulty: string): TestCase[] {
  return testCases.filter((testCase) => testCase.difficulty === difficulty);
}
