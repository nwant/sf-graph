
import { jest } from '@jest/globals';

// 1. Define Mock Functions
const mockGetGlobalContext = jest.fn();

const mockGetObjectByApiName = jest.fn();
const mockGetObjectFields = jest.fn();
const mockIsLLMAvailable = jest.fn();
const mockValidateAndCorrectSoqlEnhanced = jest.fn();
const mockClassifyEntities = jest.fn();
const mockExtractPotentialEntities = jest.fn();
const mockExtractSoqlBlock = jest.fn();

const mockDecomposerChat = jest.fn();
const mockCoderChat = jest.fn();
const mockAgentInitialize = jest.fn();
const mockAgentDisconnect = jest.fn();

// Mock Agent Class
const mockAgentCreateWithInProcessTools = jest.fn().mockImplementation(({ systemPrompt }) => {
  if (systemPrompt && systemPrompt.includes('Salesforce Query Compiler')) {
    return {
      initialize: mockAgentInitialize,
      chat: mockDecomposerChat,
      disconnect: mockAgentDisconnect
    };
  } else {
    return {
      initialize: mockAgentInitialize,
      chat: mockCoderChat,
      disconnect: mockAgentDisconnect
    };
  }
});

// 2. Mock Modules using unstable_mockModule (for ESM)

jest.unstable_mockModule('../../../dist/services/graph-rag-service.js', () => ({
  graphRagService: {
    getGlobalContext: mockGetGlobalContext
  }
}));

jest.unstable_mockModule('../../../dist/services/llm-service.js', () => ({
  isLLMAvailable: mockIsLLMAvailable,
  processWithLLM: jest.fn().mockResolvedValue('Processed'),
  extractStructuredData: jest.fn().mockResolvedValue({}),
  generateSoqlWithLLM: jest.fn().mockResolvedValue('SELECT Id FROM Account'),
  getAvailableModels: jest.fn().mockResolvedValue([{ name: 'gpt-4' }])
}));

jest.unstable_mockModule('../../../dist/services/neo4j/graph-service.js', () => ({
  getObjectByApiName: mockGetObjectByApiName,
  getObjectFields: mockGetObjectFields,
  findSoqlPaths: jest.fn(),
  getObjectRelationships: jest.fn(),
  executeRead: jest.fn(),
  getAllObjects: jest.fn().mockResolvedValue([{ apiName: 'Account', label: 'Account' }]),
  getChildRelationships: jest.fn().mockResolvedValue([]),
  getPicklistValues: jest.fn().mockResolvedValue([]),
  findObjectsByPicklistValue: jest.fn().mockResolvedValue([]),
  findDetailedPaths: jest.fn().mockResolvedValue([]),
  findObjectPaths: jest.fn().mockResolvedValue([]),
  findRelatedObjects: jest.fn().mockResolvedValue([]),
  getMetadataRelationships: jest.fn().mockResolvedValue([]),
  get1HopNeighborSummaries: jest.fn().mockResolvedValue([])
}));

jest.unstable_mockModule('../../../dist/services/soql-validator.js', () => ({
  validateAndCorrectSoqlEnhanced: mockValidateAndCorrectSoqlEnhanced
}));

const mockBuildDecomposerGroundingContext = jest.fn().mockResolvedValue('');

jest.unstable_mockModule('../../../dist/services/entity-classifier.js', () => ({
  classifyEntities: mockClassifyEntities,
  buildDecomposerGroundingContext: mockBuildDecomposerGroundingContext
}));

jest.unstable_mockModule('../../../dist/services/schema-context/index.js', () => ({
  extractPotentialEntities: mockExtractPotentialEntities,
  formatSchemaForPrompt: jest.fn(),
  detectRelationshipIntent: jest.fn(),
  FuzzySchemaContextProvider: class { getContext = jest.fn() },
  defaultSchemaContextProvider: { invalidateCache: jest.fn(), getContext: jest.fn() },
  findMatchingObjects: jest.fn().mockResolvedValue({ objects: [], picklistMatches: [], contextObjectNames: [] })
}));

jest.unstable_mockModule('../../../dist/agent/index.js', () => ({
  Agent: {
    createWithInProcessTools: mockAgentCreateWithInProcessTools
  }
}));

jest.unstable_mockModule('../../../dist/services/soql-ast-parser.js', () => ({
  extractSoqlBlock: mockExtractSoqlBlock
}));

// Mock peripheral-vision module to avoid Neo4j calls
jest.unstable_mockModule('../../../dist/services/peripheral-vision/index.js', () => ({
  scoreNeighborsWithFallback: jest.fn().mockResolvedValue([]),
  scoreNeighborsHybrid: jest.fn().mockResolvedValue([]),
  calculateJaccardSimilarity: jest.fn().mockReturnValue(0),
  checkVectorAvailability: jest.fn().mockResolvedValue(false),
  HYBRID_SCORING_DEFAULTS: {
    semanticWeight: 0.6,
    graphWeight: 0.4,
    junctionBonus: 0.15,
  },
  batchGetGraphSignals: jest.fn().mockResolvedValue(new Map()),
  computeGraphScore: jest.fn().mockReturnValue(0),
}));

// Mock soql/lexical-scoring to avoid import issues
jest.unstable_mockModule('../../../dist/services/soql/lexical-scoring.js', () => ({
  rankFieldsByLexicalRelevance: jest.fn().mockReturnValue([]),
  calculateFieldRelevanceLexical: jest.fn().mockReturnValue(0),
  tokenizeQuery: jest.fn().mockReturnValue([]),
  LEXICAL_SCORING: {
    EXACT_MATCH: 10,
    PARTIAL_MATCH: 5,
    DESCRIPTION_MATCH: 2,
    REFERENCE_BOOST: 1,
  },
}));

// 3. Import System Under Test (Dynamic Import needed after mocks)
let generateSoqlFromNaturalLanguage;
let neo4jAvailable = false;

describe('MAC-SQL Generator', () => {
  beforeAll(async () => {
    // Check Neo4j availability from global setup state
    try {
      const fs = await import('fs');
      const path = await import('path');
      const stateFile = path.join(process.cwd(), 'tests', '.neo4j-test-state.json');
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        neo4jAvailable = state.neo4jAvailable;
      }
    } catch (_e) { /* ignore */ }
    
    // Import the module AFTER mocking
    const module = await import('../../../dist/services/soql-generator.js');
    generateSoqlFromNaturalLanguage = module.generateSoqlFromNaturalLanguage;
  }, 60000);

  beforeEach(() => {
    jest.clearAllMocks();

    // Default Successful Mocks
    mockIsLLMAvailable.mockResolvedValue(true);
    mockGetGlobalContext.mockResolvedValue('Global Context Summary');
    
    // Graph Mocks
    mockGetObjectByApiName.mockImplementation((name) => Promise.resolve({ apiName: name, label: name }));
    mockGetObjectFields.mockResolvedValue([
      { apiName: 'Id', type: 'id' },
      { apiName: 'Name', type: 'string' }
    ]);

    // Entity Mocks
    mockExtractPotentialEntities.mockReturnValue({ entities: ['Microsoft'], potentialValues: [] });
    mockClassifyEntities.mockResolvedValue([
      { value: 'Microsoft', confidence: 0.9, suggestedPatterns: [{ pattern: "Name LIKE 'Microsoft%'" }] }
    ]);

    // Parser Mocks
    mockExtractSoqlBlock.mockImplementation((text) => {
      // Simple mock: extract anything inside ```soql ... ```
      const match = text.match(/```soql\s*([\s\S]*?)\s*```/);
      return match ? match[1].trim() : null;
    });

    // Validator Mocks
    mockValidateAndCorrectSoqlEnhanced.mockResolvedValue({
      isValid: true,
      soql: 'SELECT Id FROM Account',
      messages: [],
      // Mock other properties used in return
      parsed: { mainObject: 'Account' }
    });

    // Agent Chat Mocks
    mockDecomposerChat.mockResolvedValue(`\`\`\`json
{
  "summary": "Plan summary",
  "relevantTables": ["Account"],
  "relevantColumns": ["Account.Name"]
}
\`\`\``);
    
    mockCoderChat.mockResolvedValue(`Thinking process...
\`\`\`soql
SELECT Id FROM Account
\`\`\``);
  });

  it('should orchestrate Decomposer and Coder agents', async () => {
    if (!neo4jAvailable) {
      console.log('⏭️  Neo4j not available, skipping MAC-SQL test');
      return;
    }
    const result = await generateSoqlFromNaturalLanguage('Show me accounts');

    // Verify Decomposer called
    expect(mockDecomposerChat).toHaveBeenCalled();
    const decomposerPrompt = mockDecomposerChat.mock.calls[0][0];
    expect(decomposerPrompt).toContain('Global Context Summary');
    expect(decomposerPrompt).toContain('Show me accounts');

    // Verify Graph Fetching (Schema Pruning)
    expect(mockGetObjectByApiName).toHaveBeenCalledWith('Account', expect.any(Object));

    // Verify Coder called
    expect(mockCoderChat).toHaveBeenCalled();
    const coderPrompt = mockCoderChat.mock.calls[0][0];
    expect(coderPrompt).toContain('Plan summary');
    expect(coderPrompt).toContain('RELEVANT TABLES: Account');
    expect(coderPrompt).toContain('OBJECT: Account'); // Schema Pruning Check

    // Verify Result
    expect(result.soql).toBe('SELECT Id FROM Account');
  });

  it('should handle validation errors and retry coder', async () => {
    if (!neo4jAvailable) {
      console.log('⏭️  Neo4j not available, skipping MAC-SQL retry test');
      return;
    }
    // Attempt 1: Coder returns bad SOQL (validator rejects it)
    mockCoderChat.mockResolvedValueOnce(`\`\`\`soql
SELECT Bad FROM Account
\`\`\``);
    
    mockValidateAndCorrectSoqlEnhanced
       .mockResolvedValueOnce({ 
         isValid: false, 
         messages: [{ type: 'error', message: 'Field Bad does not exist' }] 
       })
       .mockResolvedValue({ isValid: true, soql: 'SELECT Id FROM Account', messages: [], parsed: { mainObject: 'Account' } });

    // Attempt 2: Coder returns good SOQL
    mockCoderChat.mockResolvedValueOnce(`\`\`\`soql
SELECT Id FROM Account
\`\`\``);

    await generateSoqlFromNaturalLanguage('Show me accounts');

    expect(mockCoderChat.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockCoderChat.mock.calls[1][0]).toContain('Field Bad does not exist');
  });
});
