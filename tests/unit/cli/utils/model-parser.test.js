import { jest } from '@jest/globals';

// Mock the config module using unstable_mockModule for ESM support
// Must be called before importing the module under test
jest.unstable_mockModule('../../../../dist/agent/config.js', () => ({
  loadConfig: jest.fn()
}));

// Import modules dynamically after mocking
const { parseModelFlag } = await import('../../../../dist/cli/utils/model-parser.js');
const { loadConfig } = await import('../../../../dist/agent/config.js');

describe('Model Parser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default config mock
    loadConfig.mockReturnValue({
      provider: 'ollama',
      model: 'default-model'
    });
  });

  test('parses provider:model string correctly', () => {
    expect(parseModelFlag('openai:gpt-4o')).toEqual({ 
      provider: 'openai', 
      model: 'gpt-4o' 
    });
    
    expect(parseModelFlag('claude:claude-3-sonnet')).toEqual({ 
      provider: 'claude', 
      model: 'claude-3-sonnet' 
    });
    
    expect(parseModelFlag('gemini:gemini-pro')).toEqual({ 
      provider: 'gemini', 
      model: 'gemini-pro' 
    });
  });

  test('handles ollama models with colons', () => {
    expect(parseModelFlag('ollama:llama3.1:8b')).toEqual({ 
      provider: 'ollama', 
      model: 'llama3.1:8b' 
    });
  });

  test('handles model only (uses default provider from config)', () => {
    expect(parseModelFlag('custom-model')).toEqual({ 
      provider: 'ollama', 
      model: 'custom-model' 
    });
  });

  test('handles undefined flag (uses full config default)', () => {
    expect(parseModelFlag(undefined)).toEqual({ 
      provider: 'ollama', 
      model: 'default-model' 
    });
  });
  
  test('respects different config defaults', () => {
    loadConfig.mockReturnValue({
      provider: 'openai',
      model: 'gpt-3.5-turbo'
    });
    
    expect(parseModelFlag('gpt-4')).toEqual({ 
      provider: 'openai', 
      model: 'gpt-4' 
    });
    
    expect(parseModelFlag(undefined)).toEqual({ 
      provider: 'openai', 
      model: 'gpt-3.5-turbo' 
    });
  });
});
