#!/usr/bin/env node
/**
 * MCP Tool Eval Runner
 *
 * Runs evaluation test cases against the MCP tools and generates a report.
 *
 * Usage:
 *   node tests/evals/run-evals.js
 *   node tests/evals/run-evals.js --category=discovery
 *   node tests/evals/run-evals.js --verbose
 */
import { mcpToolEvalCases, runEvalCase, generateEvalReport } from './mcp-tool-evals.js';
import { schemaTools } from '../../src/mcp/tools/schema-tools.js';
import { soqlTools } from '../../src/mcp/tools/soql-tools.js';
import { dataTools } from '../../src/mcp/tools/data-tools.js';
import { llmTools } from '../../src/mcp/tools/llm-tools.js';
import { initNeo4jDriver } from '../../src/services/neo4j/driver.js';


// Combine all tools into a map for easy lookup
const allTools = [...schemaTools, ...soqlTools, ...dataTools, ...llmTools];
const toolMap = new Map(allTools.map((t) => [t.name, t]));

/**
 * Execute a tool by name with given params
 */
async function executeToolByName(toolName, params) {
  const tool = toolMap.get(toolName);
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }
  return await tool.handler(params);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    category: null,
    verbose: false,
    ids: [],
  };

  for (const arg of args) {
    if (arg.startsWith('--category=')) {
      options.category = arg.split('=')[1];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg.startsWith('--id=')) {
      options.ids.push(arg.split('=')[1]);
    }
  }

  return options;
}

/**
 * Main eval runner
 */
async function main() {
  const options = parseArgs();

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║          MCP Tool Evaluation Runner                    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');

  // Initialize Neo4j if available
  try {
    if (process.env.NEO4J_URI) {
      console.log('🔌 Connecting to Neo4j...');
      await initNeo4jDriver();
      console.log('✅ Neo4j connected\n');
    } else {
      console.log('⚠️  Neo4j not configured - some tools will fail\n');
    }
  } catch (error) {
    console.log(`⚠️  Neo4j connection failed: ${error.message}\n`);
  }

  // Filter eval cases based on options
  let casesToRun = mcpToolEvalCases;

  if (options.category) {
    casesToRun = casesToRun.filter((c) => c.category === options.category);
    console.log(`📂 Filtering to category: ${options.category}`);
  }

  if (options.ids.length > 0) {
    casesToRun = casesToRun.filter((c) => options.ids.includes(c.id));
    console.log(`🎯 Running specific IDs: ${options.ids.join(', ')}`);
  }

  console.log(`📋 Running ${casesToRun.length} eval cases...\n`);

  // Run each eval case
  const results = [];
  for (const evalCase of casesToRun) {
    process.stdout.write(`  ${evalCase.id}: ${evalCase.prompt.substring(0, 50)}... `);

    try {
      const result = await runEvalCase(evalCase, executeToolByName);
      results.push(result);

      if (result.passed) {
        console.log('✅');
      } else {
        console.log('❌');
        if (options.verbose) {
          console.log(`    Details: ${JSON.stringify(result.details)}`);
        }
      }
    } catch (error) {
      results.push({
        id: evalCase.id,
        prompt: evalCase.prompt,
        passed: false,
        details: { error: error.message },
      });
      console.log(`❌ (${error.message})`);
    }
  }

  // Generate and print report
  const report = generateEvalReport(results);

  console.log('\n════════════════════════════════════════════════════════');
  console.log('                      EVAL REPORT');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log(
    `📊 Overall: ${report.summary.passed}/${report.summary.total} passed (${report.summary.passRate})`
  );
  console.log('');
  console.log('By Category:');
  for (const [category, stats] of Object.entries(report.byCategory)) {
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    console.log(`  ${category.padEnd(20)} ${bar} ${stats.passed}/${stats.total} (${pct}%)`);
  }

  console.log('');

  // Print failed cases if any
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log('❌ Failed Cases:');
    for (const f of failed) {
      console.log(`  - ${f.id}: ${f.prompt.substring(0, 60)}`);
      if (f.details.error) {
        console.log(`    Error: ${f.details.error}`);
      }
    }
  }

  // Exit with appropriate code
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Eval runner failed:', error);
  process.exit(1);
});
