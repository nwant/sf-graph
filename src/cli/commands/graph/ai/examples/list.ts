/**
 * sf graph ai examples list
 *
 * List few-shot examples in the store.
 */

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { FewShotExampleStore } from '../../../../../services/few-shot/example-store.js';
import { initNeo4jDriver, closeDriver } from '../../../../../services/neo4j/driver.js';
import type { SoqlExample } from '../../../../../services/few-shot/types.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.ai.examples.list');

export type ListResult = {
  examples: SoqlExample[];
  total: number;
};

export default class List extends SfCommand<ListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');

  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    pattern: Flags.string({
      char: 'p',
      summary: messages.getMessage('flags.pattern.summary'),
    }),
    limit: Flags.integer({
      char: 'l',
      summary: messages.getMessage('flags.limit.summary'),
      default: 10,
    }),
    json: Flags.boolean({
      summary: messages.getMessage('flags.json.summary'),
      default: false,
    }),
  };

  public async run(): Promise<ListResult> {
    const { flags } = await this.parse(List);

    try {
      await initNeo4jDriver();
      
      const store = new FewShotExampleStore();
      const total = await store.getExampleCount();

      if (total === 0) {
        if (!flags.json) {
          this.log(messages.getMessage('info.no-examples'));
        }
        return { examples: [], total: 0 };
      }

      let examples: SoqlExample[];
      if (flags.pattern) {
        examples = await store.getExamplesByPattern(flags.pattern, flags.limit);
      } else {
        examples = await store.getAllExamples(flags.limit);
      }

      if (!flags.json) {
        this.log(`\n${messages.getMessage('info.list-header', [examples.length, total])}\n`);
        
        for (const ex of examples) {
          this.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          this.log(`ID: ${ex.id} | Complexity: ${ex.complexity}`);
          this.log(`Patterns: ${ex.patterns.join(', ')}`);
          this.log(`Question: ${ex.question}`);
          this.log(`SOQL: ${ex.soql}`);
          if (ex.explanation) {
            this.log(`Note: ${ex.explanation}`);
          }
        }
        
        this.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        if (flags.pattern) {
          this.log(messages.getMessage('info.showing-pattern', [flags.pattern]));
        }
        this.log(messages.getMessage('info.hint'));
      }

      return { examples, total };
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    } finally {
      await closeDriver();
    }
  }
}
