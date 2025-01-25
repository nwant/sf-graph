/**
 * sf graph ai soql
 *
 * Generate SOQL from natural language using AI.
 */


import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages, Org } from '@salesforce/core';
import { generateSoqlFromNaturalLanguage } from '../../../../services/soql-generator.js';
import { initNeo4jDriver, closeDriver } from '../../../../services/neo4j/driver.js';
import { parseModelFlag } from '../../../utils/model-parser.js';
import { apiService } from '../../../../core/api-service.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-graph', 'graph.ai.soql');

export type SoqlResult = {
  query: string;
  mainObject?: string;
  isValid: boolean;
  warnings?: string[];
};

export default class Soql extends SfCommand<SoqlResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    query: Args.string({
      description: messages.getMessage('args.query.description'),
      required: true,
    }),
  };

  public static readonly flags = {
    'target-org': Flags.string({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    model: Flags.string({
      char: 'm',
      summary: messages.getMessage('flags.model.summary'),
    }),
    'decomposer-model': Flags.string({
      summary: 'Override the model used for decomposition (default: gpt-4o-mini)',
      char: 'd', // Optional char shortcut
    }),
    json: Flags.boolean({
      summary: 'Format output as JSON.',
      default: false,
    }),
    quiet: Flags.boolean({
      char: 'q',
      summary: messages.getMessage('flags.quiet.summary'),
      default: false,
    }),
  };

  public async run(): Promise<SoqlResult> {
    const { args, flags } = await this.parse(Soql);

    if (!flags.quiet && !flags.json) {
      this.spinner.start('Generating SOQL from natural language...');
    }

    try {
      // Initialize Neo4j for schema context
      await initNeo4jDriver();
      
      const { provider, model } = parseModelFlag(flags.model);

      // Resolve target-org alias to ID if provided
      let orgId = flags['target-org'];
      if (orgId) {
        try {
          const org = await Org.create({ aliasOrUsername: orgId });
          orgId = org.getOrgId();
        } catch (error) {
          // If resolution fails (e.g. offline or just an ID), use the value as-is
          // This allows querying by ID directly even if not authenticated in some cases
        }
      }

      // Check if org has data in graph (warn if empty)
      try {
        await apiService.checkOrgHasData(orgId);
      } catch (error) {
        // Log warning but continue - LLM can still generate from training data
        if (!flags.quiet && !flags.json) {
          this.warn((error as Error).message);
          this.log('Continuing with LLM-only generation (no schema context)...\n');
        }
      }

      const result = await generateSoqlFromNaturalLanguage(args.query, {
        orgId,
        provider,
        model,
        decomposerModel: flags['decomposer-model'],
        onFewShotProgress: (!flags.quiet && !flags.json) 
          ? (msg) => this.log(msg) 
          : undefined,
      });

      if (!flags.quiet && !flags.json) {
        this.spinner.stop();
        if (result.contextStats) {
          const { objectCount, totalFields } = result.contextStats;
          this.log(`Built schema context: ${objectCount} objects, ${totalFields} fields`);
        }
      }

      // Collect warnings from validation messages
      const warnings = result.validation.messages
        .filter((m) => m.type === 'warning')
        .map((m) => m.message);

      if (!flags.json) {
        // Print just the SOQL by default (for piping)
        if (flags.quiet) {
          this.log(result.soql);
        } else {
          this.log('');
          this.log(result.soql);
          this.log('');
          
          if (warnings.length > 0) {
            this.log('⚠️  Warnings:');
            for (const w of warnings) {
              this.log(`   - ${w}`);
            }
            this.log('');
          }

          if (!result.isValid) {
            const errors = result.validation.messages
              .filter((m) => m.type === 'error')
              .map((m) => m.message);
            
            if (errors.length > 0) {
              this.log('❌ Validation Errors:');
              for (const e of errors) {
                this.log(`   - ${e}`);
              }
              this.log('');
            }
          }
        }
      }

      return {
        query: result.soql,
        mainObject: result.mainObject,
        isValid: result.isValid,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      if (!flags.quiet && !flags.json) {
        this.spinner.stop();
      }
      this.error(error instanceof Error ? error.message : String(error));
    } finally {
      await closeDriver();
    }
  }
}
