/**
 * sf graph ai examples seed
 *
 * Seed the few-shot example store with curated SOQL examples.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { FewShotExampleStore } from '../../../../../services/few-shot/example-store.js';
import { getEmbeddingProvider } from '../../../../../services/embeddings/embedding-service.js';
import { initNeo4jDriver, closeDriver } from '../../../../../services/neo4j/driver.js';
import { createRequire } from 'node:module';
import type { SoqlExample } from '../../../../../services/few-shot/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.ai.examples.seed');

const require = createRequire(import.meta.url);

export type SeedResult = {
  seededCount: number;
  embeddingModel: string;
};

export default class Seed extends SfCommand<SeedResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');

  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    force: Flags.boolean({
      char: 'f',
      summary: messages.getMessage('flags.force.summary'),
      default: false,
    }),
    json: Flags.boolean({
      summary: messages.getMessage('flags.json.summary'),
      default: false,
    }),
  };

  public async run(): Promise<SeedResult> {
    const { flags } = await this.parse(Seed);

    if (!flags.json) {
      this.spinner.start(messages.getMessage('info.initializing'));
    }

    try {
      // Initialize Neo4j
      await initNeo4jDriver();
      
      const store = new FewShotExampleStore();
      const provider = getEmbeddingProvider();
      const modelName = provider.modelName;

      // Check existing state
      const currentCount = await store.getExampleCount();
      const storedModel = await store.getStoredEmbeddingModel();

      if (currentCount > 0 && !flags.force) {
        if (storedModel === modelName) {
          if (!flags.json) {
            this.spinner.stop();
            this.log(messages.getMessage('success.existing', [currentCount, modelName]));
            this.log(messages.getMessage('info.force-hint'));
          }
          return { seededCount: currentCount, embeddingModel: modelName };
        } else {
          if (!flags.json) {
            this.log(messages.getMessage('info.model-change', [storedModel, modelName]));
          }
        }
      }

      // Load examples from JSON
      if (!flags.json) {
        this.spinner.status = messages.getMessage('info.loading');
      }

      const examples: SoqlExample[] = require('../../../../../data/few-shot/examples.json');

      // Seed examples
      if (!flags.json) {
        this.spinner.status = messages.getMessage('info.embedding', [examples.length]);
      }

      await store.seedExamples(examples);

      if (!flags.json) {
        this.spinner.stop();
        this.log(messages.getMessage('success.seeded', [examples.length, modelName]));
        this.log('\n' + messages.getMessage('info.list-hint'));
      }

      return {
        seededCount: examples.length,
        embeddingModel: modelName,
      };
    } catch (error) {
      if (!flags.json) {
        this.spinner.stop();
      }
      this.error(error instanceof Error ? error.message : String(error));
    } finally {
      await closeDriver();
    }
  }
}
