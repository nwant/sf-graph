
import { evaluateWithSummary, evaluateComponentPerformance } from './evaluator.js';
import { testCases } from './test-cases.js';
import { isLLMAvailable, getAvailableModels } from '../services/llm-service.js';
import { loadConfig } from '../agent/config.js';
import { initNeo4jDriver, closeDriver } from '../services/neo4j/driver.js';
import fs from 'fs';
import path from 'path';
import { ComparisonResult, ComponentEvaluationResult } from './evaluator.js';

/**
 * Format a number as a percentage
 * @param value - Value to format
 * @returns Formatted percentage
 */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Generate a markdown report from evaluation results
 * @param results - Evaluation results
 * @returns Markdown report
 */
function generateMarkdownReport(results: ComparisonResult): string {
  const { results: evalResults, summary } = results;

  let markdown = `# Natural Language to SOQL Evaluation Report\n\n`;

  // Add timestamp
  markdown += `*Generated on: ${new Date().toISOString()}*\n\n`;

  // Add test case summary
  markdown += `## Test Case Summary\n\n`;
  markdown += `- Total test cases: ${summary.totalCases}\n`;
  markdown += `- Successful cases: ${summary.successfulCases}\n`;
  markdown += `- Categories: ${[...new Set(testCases.map((tc) => tc.category))].join(', ')}\n`;
  markdown += `- Difficulty levels: ${[...new Set(testCases.map((tc) => tc.difficulty))].join(', ')}\n\n`;

  // Add LLM information
  const config = loadConfig();
  markdown += `## LLM Configuration\n\n`;
  markdown += `- Default model: ${config.model}\n`;
  markdown += `- LLM is **required** for SOQL generation\n\n`;

  // Add overall performance
  markdown += `## Overall Performance\n\n`;
  markdown += `| Metric | Score |\n`;
  markdown += `| ------ | ----- |\n`;
  markdown += `| Overall Score | ${formatPercent(summary.overall.overallScore)} |\n`;
  markdown += `| Object Identification | ${formatPercent(summary.overall.objectAccuracy)} |\n`;
  markdown += `| Fields (F1) | ${formatPercent(summary.overall.fieldsF1)} |\n`;
  markdown += `| SOQL Generation Success | ${formatPercent(summary.overall.generationSuccess)} |\n\n`;

  // Add category breakdown
  markdown += `## Performance by Category\n\n`;
  markdown += `| Category | Total | Successful | Avg Score |\n`;
  markdown += `| -------- | ----- | ---------- | --------- |\n`;
  for (const [category, stats] of Object.entries(summary.byCategory)) {
    markdown += `| ${category} | ${stats.total} | ${stats.successful} | ${formatPercent(stats.avgScore)} |\n`;
  }
  markdown += `\n`;

  // Add difficulty breakdown
  markdown += `## Performance by Difficulty\n\n`;
  markdown += `| Difficulty | Total | Successful | Avg Score |\n`;
  markdown += `| ---------- | ----- | ---------- | --------- |\n`;
  for (const [difficulty, stats] of Object.entries(summary.byDifficulty)) {
    markdown += `| ${difficulty} | ${stats.total} | ${stats.successful} | ${formatPercent(stats.avgScore)} |\n`;
  }
  markdown += `\n`;

  // Add detailed test case results
  markdown += `## Detailed Test Case Results\n\n`;
  markdown += `| Test Case | Query | Object | Fields (F1) | SOQL | Overall |\n`;
  markdown += `| --------- | ----- | ------ | ----------- | ---- | ------- |\n`;

  for (const result of evalResults) {
    const objStatus = result.scores.object.correct ? '✅' : '❌';
    const soqlStatus = result.scores.soqlGenerated.success ? '✅' : '❌';
    markdown += `| ${result.testCase.description} | "${result.testCase.query}" | ${objStatus} | ${formatPercent(result.scores.fields.f1)} | ${soqlStatus} | ${formatPercent(result.scores.overall)} |\n`;
  }

  return markdown;
}

/**
 * Generate a component performance report
 * @param componentResults - Component performance results
 * @returns Markdown report
 */
function generateComponentReport(componentResults: ComponentEvaluationResult): string {
  const { components, successRates } = componentResults;

  let markdown = `# Component Performance Evaluation Report\n\n`;

  // Add timestamp
  markdown += `*Generated on: ${new Date().toISOString()}*\n\n`;

  // Add success rates
  markdown += `## Component Success Rates\n\n`;
  markdown += `| Component | Success Rate |\n`;
  markdown += `| --------- | ------------ |\n`;
  markdown += `| NLP Processing | ${formatPercent(successRates.nlpProcessing)} |\n`;
  markdown += `| SOQL Generation | ${formatPercent(successRates.soqlGeneration)} |\n`;
  markdown += `| **Overall** | ${formatPercent(successRates.overall)} |\n\n`;

  // Add detailed component results
  markdown += `## Detailed Component Results\n\n`;

  // NLP Processing
  markdown += `### NLP Processing\n\n`;
  markdown += `| Test Case | Success | Notes |\n`;
  markdown += `| --------- | ------- | ----- |\n`;

  for (const result of components.nlpProcessing) {
    let notes = '';
    if (result.error) {
      notes = `Error: ${result.error}`;
    } else if (result.success) {
      notes = 'LLM analysis completed';
    }

    markdown += `| ${result.testCase.description} | ${result.success ? '✅' : '❌'} | ${notes} |\n`;
  }

  markdown += `\n`;

  // SOQL Generation
  markdown += `### SOQL Generation\n\n`;
  markdown += `| Test Case | Success | Notes |\n`;
  markdown += `| --------- | ------- | ----- |\n`;

  for (const result of components.soqlGeneration) {
    let notes = '';
    if (result.error) {
      notes = `Error: ${result.error}`;
    } else if (result.result && typeof result.result === 'object' && 'soql' in result.result) {
      notes = `Generated: ${(result.result as Record<string, unknown>).soql}`;
    }

    markdown += `| ${result.testCase.description} | ${result.success ? '✅' : '❌'} | ${notes} |\n`;
  }

  return markdown;
}

/**
 * Save a report to a file
 * @param content - Report content
 * @param filename - Filename
 */
function saveReport(content: string, filename: string): void {
  const reportsDir = path.join(process.cwd(), 'reports');

  // Create reports directory if it doesn't exist
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const filePath = path.join(reportsDir, filename);
  fs.writeFileSync(filePath, content);

  console.log(`Report saved to ${filePath}`);
}

/**
 * Run the evaluation and generate reports
 */
async function runEvaluation(): Promise<void> {
  console.log('=== Natural Language to SOQL Evaluation ===\n');

  // Initialize Neo4j driver
  try {
    console.log('Initializing Neo4j driver...');
    await initNeo4jDriver();
    console.log('Neo4j driver initialized successfully');
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Failed to initialize Neo4j driver:', err.message);
    console.log('Continuing with evaluation, but some tests may fail...');
  }

  // Check if LLM is available (required for new architecture)
  const llmAvailable = await isLLMAvailable();
  console.log(`LLM service available: ${llmAvailable}`);

  if (!llmAvailable) {
    console.error('\nError: LLM is required for SOQL generation but is not available.');
    console.error('Please ensure Ollama is running and configured.');
    await closeDriver();
    process.exit(1);
  }

  const models = await getAvailableModels();
  console.log(`Available models: ${models.map((m) => m.name).join(', ')}`);
  const config = loadConfig();
  console.log(`Using model: ${config.model}\n`);

  // Run evaluation with summary
  console.log('Running evaluation...');
  try {
    const results = await evaluateWithSummary();

    // Generate and save report
    console.log('Generating report...');
    const report = generateMarkdownReport(results);
    saveReport(report, 'soql-evaluation.md');
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Evaluation failed:', err.message);
  }

  // Run component performance evaluation
  console.log('\nRunning component performance evaluation...');
  try {
    const componentResults = await evaluateComponentPerformance();

    // Generate and save component report
    console.log('Generating component report...');
    const componentReport = generateComponentReport(componentResults);
    saveReport(componentReport, 'component-evaluation.md');
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Component evaluation failed:', err.message);
  }

  console.log('\n=== Evaluation Complete ===');
  await closeDriver();
}

// Run the evaluation
runEvaluation().catch((error) => {
  console.error('Evaluation failed:', error);
  process.exit(1);
});
