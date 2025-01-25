import { AgentConfig } from '../../agent/config.js';

export async function ensureOllamaModelIfNeeded(
  provider: AgentConfig['provider'] | undefined,
  model: string,
  baseUrl?: string
): Promise<void> {
  // Logic:
  // Only auto-pull if we are fairly sure it's for Ollama.
  // If explicit provider is ollama OR no explicit provider and global is ollama
  // AND it doesn't look like an openai/claude model (heuristic)
  
  // Note: we can't easily access the "effective" provider here if 'provider' is undefined without loading config, 
  // but the caller usually passes the effective or explicit provider.
  // If provider is undefined, we assume the caller wants us to check heuristics or default to false to be safe?
  // Actually, let's allow the caller to pass just the model and we'll heuristic check if provider is missing.
  // But cleaner is if caller resolves provider first.

  const isOllama = provider === 'ollama' && !model.startsWith('gpt-') && !model.startsWith('claude-') && !model.startsWith('gemini-');

  if (isOllama) {
    try {
      const { OllamaProvider } = await import('../../llm/providers/ollama-provider.js');
      console.log(`Checking if model '${model}' exists in Ollama...`);
      const ollama = new OllamaProvider({ baseUrl });
      if (await ollama.isAvailable()) {
        await ollama.ensureModelExists(model);
      } else {
        console.warn('⚠️  Ollama server is not reachable. Skipping model pull.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn(`⚠️  Could not auto-pull model: ${msg}`);
    }
  }
}
