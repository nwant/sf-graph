import { loadConfig } from '../../agent/config.js';
import { LlmProviderType } from '../../llm/index.js';

export interface ParsedModel {
  provider: LlmProviderType;
  model: string;
}

/**
 * Parse combined provider:model flag (e.g., "openai:gpt-4o", "ollama:llama3.1:8b")
 * Falls back to default config if no provider specified or no flag provided.
 */
export function parseModelFlag(flagValue?: string): ParsedModel {
  const config = loadConfig();
  let provider = config.provider;
  let model = config.model;

  if (flagValue) {
    const knownProviders = ['ollama', 'openai', 'claude', 'gemini'];
    const prefixMatch = knownProviders.find(p => flagValue.startsWith(`${p}:`));

    if (prefixMatch) {
      provider = prefixMatch as LlmProviderType;
      model = flagValue.substring(prefixMatch.length + 1);
    } else {
      // No provider prefix, use default provider but override model
      model = flagValue;
    }
  }

  return { provider, model };
}
