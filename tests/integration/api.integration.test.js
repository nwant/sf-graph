// Native fetch is available in Node 18+

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const testQueries = [
  { description: 'Basic Account Query', query: 'Show me all accounts in California' },
];

describe('API Integration Tests', () => {
  let serverAvailable = false;

  beforeAll(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      if (res.ok) serverAvailable = true;
    } catch (_e) {
      console.warn('API server not running at ' + API_BASE_URL);
    }
  });

  test('GET /soql/llm-status', async () => {
    if (!serverAvailable) {
      console.warn('Skipping API test');
      return;
    }
    const res = await fetch(`${API_BASE_URL}/soql/llm-status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('success');
  });

  test('POST /soql/generate', async () => {
    if (!serverAvailable) return;

    const testCase = testQueries[0];
    const res = await fetch(`${API_BASE_URL}/soql/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: testCase.query, options: { useLLM: false } }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('query');
    expect(data.query).toHaveProperty('soql');
  });
});
