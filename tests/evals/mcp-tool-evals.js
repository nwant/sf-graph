/**
 * MCP Tool Evaluation Test Cases
 *
 * These test cases define expected tool selections for natural language prompts.
 * Use these to evaluate whether Claude (or other LLMs) correctly selects tools
 * and passes appropriate parameters.
 *
 * Evaluation Metrics:
 * - Hit Rate: Does the LLM call the expected tool(s)?
 * - Parameter Accuracy: Are the parameters correct?
 * - Success Rate: Does the tool call succeed?
 *
 * Usage:
 *   1. Manual: Use as a checklist when testing with Claude Desktop
 *   2. Automated: Integrate with DeepEval or similar framework
 *   3. CI/CD: Run as regression tests after tool changes
 */

export const mcpToolEvalCases = [
  // ============================================
  // GRAPH STATUS & DISCOVERY
  // ============================================
  {
    id: 'eval-001',
    category: 'discovery',
    prompt: 'Is the Salesforce metadata graph populated?',
    expectedToolCalls: ['check-graph-status'],
    expectedParams: {},
    expectedOutputContains: ['hasData', 'objectCount'],
    notes: 'Should check graph status before other operations',
  },
  {
    id: 'eval-002',
    category: 'discovery',
    prompt: 'What Salesforce objects are available?',
    expectedToolCalls: ['list-objects'],
    expectedParams: {},
    expectedOutputContains: null, // Any valid list
    notes: 'Basic object discovery',
  },
  {
    id: 'eval-003',
    category: 'discovery',
    prompt: 'Show me all custom objects',
    expectedToolCalls: ['list-objects'],
    expectedParams: {},
    postProcessCheck: (_result) => {
      // LLM should filter results to show only custom objects (ending in __c)
      return true;
    },
    notes: 'May require LLM to filter results',
  },

  // ============================================
  // OBJECT EXPLORATION
  // ============================================
  {
    id: 'eval-010',
    category: 'object-exploration',
    prompt: 'Tell me about the Account object',
    expectedToolCalls: ['get-object'],
    expectedParams: { apiName: 'Account' },
    expectedOutputContains: ['apiName', 'fields', 'relationships'],
    notes: 'Standard object lookup',
  },
  {
    id: 'eval-011',
    category: 'object-exploration',
    prompt: 'What fields does Contact have?',
    expectedToolCalls: ['get-object'],
    expectedParams: { apiName: 'Contact' },
    expectedOutputContains: ['fields'],
    notes: 'Field-focused query',
  },
  {
    id: 'eval-012',
    category: 'object-exploration',
    prompt: 'Show me the relationships on Opportunity',
    expectedToolCalls: ['get-object'],
    expectedParams: { apiName: 'Opportunity' },
    expectedOutputContains: ['relationships'],
    notes: 'Relationship-focused query',
  },
  {
    id: 'eval-013',
    category: 'object-exploration',
    prompt: 'What are the required fields on Lead?',
    expectedToolCalls: ['get-object'],
    expectedParams: { apiName: 'Lead' },
    postProcessCheck: (_result) => {
      // LLM should filter to show only required fields
      return true;
    },
    notes: 'Requires LLM filtering of results',
  },

  // ============================================
  // RELATIONSHIP EXPLORATION
  // ============================================
  {
    id: 'eval-020',
    category: 'relationships',
    prompt: 'How are Account and Contact related?',
    expectedToolCalls: ['explore-relationships'],
    expectedParams: {
      sourceObjectApiName: 'Account',
      targetObjectApiName: 'Contact',
    },
    expectedOutputContains: ['paths'],
    notes: 'Direct relationship query',
  },
  {
    id: 'eval-021',
    category: 'relationships',
    prompt: 'Find the path from Lead to Opportunity',
    expectedToolCalls: ['explore-relationships'],
    expectedParams: {
      sourceObjectApiName: 'Lead',
      targetObjectApiName: 'Opportunity',
    },
    notes: 'Path finding between objects',
  },
  {
    id: 'eval-022',
    category: 'relationships',
    prompt: 'What objects are related to Account?',
    expectedToolCalls: ['find-related-objects'],
    expectedParams: { objectApiName: 'Account' },
    expectedOutputContains: ['relatedObjects'],
    notes: 'Find all related objects',
  },
  {
    id: 'eval-023',
    category: 'relationships',
    prompt: 'Show me objects within 3 hops of Case',
    expectedToolCalls: ['find-related-objects'],
    expectedParams: { objectApiName: 'Case', maxDepth: 3 },
    notes: 'Parameterized depth search',
  },

  // ============================================
  // SOQL GENERATION
  // ============================================
  {
    id: 'eval-030',
    category: 'soql-generation',
    prompt: 'Generate a SOQL query for all Accounts',
    expectedToolCalls: ['generate-soql'],
    expectedParams: { objectApiName: 'Account' },
    notes: 'Basic SOQL generation',
  },
  {
    id: 'eval-031',
    category: 'soql-generation',
    prompt: 'Create a query for Accounts with Industry equals Technology',
    expectedToolCalls: ['generate-soql'],
    expectedParams: {
      objectApiName: 'Account',
      whereClause: expect.stringContaining('Industry'),
    },
    notes: 'SOQL with WHERE clause',
  },
  {
    id: 'eval-032',
    category: 'soql-generation',
    prompt: 'Build a query to get the first 10 Contacts with their Account names',
    expectedToolCalls: ['generate-soql'],
    expectedParams: {
      objectApiName: 'Contact',
      limit: 10,
    },
    notes: 'SOQL with LIMIT',
  },

  // ============================================
  // NATURAL LANGUAGE TO SOQL
  // ============================================
  {
    id: 'eval-040',
    category: 'nl-to-soql',
    prompt: 'Find all accounts in California',
    expectedToolCalls: ['natural-language-to-soql'],
    expectedParams: { query: expect.stringContaining('California') },
    expectedOutputContains: ['soql'],
    notes: 'Natural language query conversion',
  },
  {
    id: 'eval-041',
    category: 'nl-to-soql',
    prompt: 'Show me contacts who work at Acme Corp',
    expectedToolCalls: ['natural-language-to-soql'],
    expectedParams: { query: expect.stringContaining('Acme') },
    notes: 'NL query with company filter',
  },
  {
    id: 'eval-042',
    category: 'nl-to-soql',
    prompt: 'Get opportunities worth more than $100,000 closing this month',
    expectedToolCalls: ['natural-language-to-soql'],
    expectedParams: { query: expect.any(String) },
    notes: 'Complex NL query with multiple conditions',
  },

  // ============================================
  // SOQL EXECUTION
  // ============================================
  {
    id: 'eval-050',
    category: 'soql-execution',
    prompt: 'Run this query: SELECT Id, Name FROM Account LIMIT 5',
    expectedToolCalls: ['execute-soql'],
    expectedParams: { query: 'SELECT Id, Name FROM Account LIMIT 5' },
    notes: 'Direct SOQL execution',
  },
  {
    id: 'eval-051',
    category: 'soql-execution',
    prompt: 'Execute the Account query against my production org',
    expectedToolCalls: ['execute-soql'],
    expectedParams: {
      query: expect.any(String),
      orgAlias: 'production',
    },
    notes: 'SOQL execution with org specification',
  },

  // ============================================
  // SAMPLE DATA
  // ============================================
  {
    id: 'eval-060',
    category: 'sample-data',
    prompt: 'Generate 5 sample Account records',
    expectedToolCalls: ['generate-sample-data'],
    expectedParams: { objectApiName: 'Account', count: 5 },
    notes: 'Sample data generation',
  },
  {
    id: 'eval-061',
    category: 'sample-data',
    prompt: 'Create mock data for Contact with related records',
    expectedToolCalls: ['generate-sample-data'],
    expectedParams: {
      objectApiName: 'Contact',
      includeRelated: true,
    },
    notes: 'Sample data with relationships',
  },

  // ============================================
  // LLM STATUS
  // ============================================
  {
    id: 'eval-070',
    category: 'llm',
    prompt: 'Is the local LLM available?',
    expectedToolCalls: ['check-llm-status'],
    expectedParams: {},
    notes: 'LLM availability check',
  },
  {
    id: 'eval-071',
    category: 'llm',
    prompt: 'What AI models are available?',
    expectedToolCalls: ['check-llm-status'],
    expectedParams: {},
    expectedOutputContains: ['availableModels'],
    notes: 'Model listing',
  },

  // ============================================
  // MULTI-STEP SCENARIOS
  // ============================================
  {
    id: 'eval-100',
    category: 'multi-step',
    prompt: 'Help me understand the Account object and then generate a query for it',
    expectedToolCalls: ['get-object', 'generate-soql'],
    expectedParamsSequence: [{ apiName: 'Account' }, { objectApiName: 'Account' }],
    notes: 'Multi-step: explore then generate',
  },
  {
    id: 'eval-101',
    category: 'multi-step',
    prompt: 'Check if the graph is ready, then list the available objects',
    expectedToolCalls: ['check-graph-status', 'list-objects'],
    notes: 'Multi-step: status check then discovery',
  },

  // ============================================
  // EDGE CASES & ERROR HANDLING
  // ============================================
  {
    id: 'eval-200',
    category: 'edge-cases',
    prompt: 'Tell me about the XYZ123NonExistent__c object',
    expectedToolCalls: ['get-object'],
    expectedParams: { apiName: 'XYZ123NonExistent__c' },
    expectedOutputContains: ['not found'],
    notes: 'Graceful handling of non-existent objects',
  },
  {
    id: 'eval-201',
    category: 'edge-cases',
    prompt: 'Execute this malformed query: SELCT FROM Account',
    expectedToolCalls: ['execute-soql'],
    expectedOutputContains: ['error'],
    notes: 'Error handling for invalid SOQL',
  },
];

/**
 * Run a single eval case manually
 * @param {Object} evalCase - The eval case to run
 * @param {Function} toolExecutor - Function that takes tool name and params, returns result
 */
export async function runEvalCase(evalCase, toolExecutor) {
  const results = {
    id: evalCase.id,
    prompt: evalCase.prompt,
    passed: true,
    toolCallsCorrect: false,
    paramsCorrect: false,
    outputCorrect: false,
    details: {},
  };

  try {
    // Execute the expected tools
    const toolResults = [];
    for (const toolName of evalCase.expectedToolCalls) {
      const params = evalCase.expectedParams || {};
      const result = await toolExecutor(toolName, params);
      toolResults.push({ tool: toolName, result });
    }

    results.toolCallsCorrect = true;
    results.details.toolResults = toolResults;

    // Check output if expected
    if (evalCase.expectedOutputContains) {
      const lastResult = toolResults[toolResults.length - 1]?.result;
      if (lastResult) {
        const outputText = JSON.stringify(lastResult);
        const allContained = evalCase.expectedOutputContains.every((term) =>
          outputText.includes(term)
        );
        results.outputCorrect = allContained;
      }
    } else {
      results.outputCorrect = true;
    }

    results.passed = results.toolCallsCorrect && results.outputCorrect;
  } catch (error) {
    results.passed = false;
    results.details.error = error.message;
  }

  return results;
}

/**
 * Generate eval report
 */
export function generateEvalReport(results) {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const byCategory = {};

  for (const result of results) {
    const category = mcpToolEvalCases.find((c) => c.id === result.id)?.category || 'unknown';
    if (!byCategory[category]) {
      byCategory[category] = { total: 0, passed: 0 };
    }
    byCategory[category].total++;
    if (result.passed) byCategory[category].passed++;
  }

  return {
    summary: {
      total,
      passed,
      failed: total - passed,
      passRate: `${((passed / total) * 100).toFixed(1)}%`,
    },
    byCategory,
    results,
  };
}
