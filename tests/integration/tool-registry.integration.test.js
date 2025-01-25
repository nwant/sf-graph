
import { InProcessToolExecutor } from '../../dist/agent/tool-registry.js';
import { Agent } from '../../dist/agent/agent.js';

describe('ToolRegistry Integration', () => {
    let executor;

    beforeAll(() => {
        process.env.OPENAI_API_KEY = 'dummy-key';
    });

    beforeEach(() => {
        executor = new InProcessToolExecutor({
            // Mock capabilities so tools are not filtered out
            capabilities: {
                neo4j: true,
                llm: true,
                sfCli: true
            }
        });
    });

    afterEach(async () => {
        if (executor && executor.isConnected()) {
            await executor.disconnect();
        }
    });

    test('InProcessToolExecutor connects and lists tools', async () => {
        await executor.connect();
        const tools = executor.getTools();
        
        expect(tools).toBeDefined();
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);
        
        // precise check for a known primitive tool
        const listObjects = tools.find(t => t.name === 'list-objects');
        expect(listObjects).toBeDefined();
        // LlmToolDefinition uses 'parameters', not 'inputSchema'
        expect(listObjects.parameters).toBeDefined();
    });

    test('InProcessToolExecutor filters tools correctly', async () => {
        const filteredExecutor = new InProcessToolExecutor({
            capabilities: { neo4j: true },
            toolFilter: (tool) => tool.name === 'list-objects'
        });
        
        await filteredExecutor.connect();
        const tools = filteredExecutor.getTools();
        
        expect(tools.length).toBe(1);
        expect(tools[0].name).toBe('list-objects');
        
        await filteredExecutor.disconnect();
    });

    test('callTool returns stringified content', async () => {
        // This test calls list-objects which requires Neo4j
        // Skip in CI where Neo4j is not available
        let neo4jAvailable = false;
        try {
            const fs = await import('fs');
            const path = await import('path');
            const stateFile = path.join(process.cwd(), 'tests', '.neo4j-test-state.json');
            if (fs.existsSync(stateFile)) {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
                neo4jAvailable = state.neo4jAvailable;
            }
        } catch (_e) { /* ignore */ }
        
        if (!neo4jAvailable) {
            console.log('⏭️  Neo4j not available, skipping callTool test');
            return;
        }
        
        await executor.connect();
        // Mock handler or trust list-objects. list-objects usually returns data.
        // We'll trust it returns something.
        const result = await executor.callTool('list-objects', {});
        
        expect(result.success).toBe(true);
        expect(typeof result.content).toBe('string');
        if (result.success) {
            expect(() => JSON.parse(result.content)).not.toThrow();
        }
    });

    test('Agent can be created with InProcessToolExecutor', async () => {
        const agent = Agent.createWithInProcessTools({
            provider: 'ollama', // Use Ollama which doesn't require API key validation
            capabilities: { neo4j: true, llm: true, sfCli: true },
            toolFilter: (tool) => tool.name === 'list-objects'
        });

        // Initialize wraps connect
        await agent.initialize();
        
        // Access private property via casting or just trust initialize worked
        // We can check if we can call getHistory() which shouldn't fail
        expect(agent.getHistory()).toEqual([]);
        
        await agent.disconnect();
    });
});
