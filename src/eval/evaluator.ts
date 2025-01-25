import { testCases, TestCase } from './test-cases.js';
import { processNaturalLanguage } from '../services/nlp-processor.js';
import { generateSoqlFromNaturalLanguage } from '../services/soql-generator.js';
import { isLLMAvailable } from '../services/llm-service.js';

export interface EvaluationResult {
  testCase: TestCase;
  result?: {
    mainObject: string;
    soql: string;
    fields: string[];
    hasWhereClause: boolean;
    hasOrderBy: boolean;
    hasLimit: boolean;
  };
  error?: string;
  scores: {
    object: { correct: boolean; score: number };
    fields: { correct: boolean; precision: number; recall: number; f1: number };
    soqlGenerated: { success: boolean; score: number };
    overall: number;
  };
}

export interface ComparisonResult {
  results: EvaluationResult[];
  summary: {
    totalCases: number;
    successfulCases: number;
    byCategory: Record<string, { total: number; successful: number; avgScore: number }>;
    byDifficulty: Record<string, { total: number; successful: number; avgScore: number }>;
    overall: {
      objectAccuracy: number;
      fieldsF1: number;
      generationSuccess: number;
      overallScore: number;
    };
  };
}

export interface ComponentEvaluationResult {
  components: {
    nlpProcessing: Array<{ testCase: TestCase; success: boolean; result?: unknown; error?: string }>;
    soqlGeneration: Array<{ testCase: TestCase; success: boolean; result?: unknown; error?: string }>;
  };
  successRates: {
    nlpProcessing: number;
    soqlGeneration: number;
    overall: number;
  };
}

/**
 * Evaluate a single test case.
 * Note: LLM is now required for SOQL generation.
 * 
 * @param testCase - Test case to evaluate
 * @returns Evaluation results
 */
export async function evaluateTestCase(testCase: TestCase): Promise<EvaluationResult> {
  try {
    console.log(`Evaluating test case: "${testCase.description}"`);
    console.log(`Query: "${testCase.query}"`);

    // Generate SOQL from natural language (LLM required)
    const result = await generateSoqlFromNaturalLanguage(testCase.query);

    const parsed = result.validation.parsed;
    const fields = parsed?.fields || [];

    // Evaluate object identification
    const objectCorrect = result.mainObject.toLowerCase() === (testCase.expectedObject || '').toLowerCase();

    // Evaluate field selection
    const expectedFieldsSet = new Set(testCase.expectedFields.map(f => f.toLowerCase()));
    const actualFieldsSet = new Set(fields.map(f => f.toLowerCase()));
    
    const matchingFields = fields.filter(f => expectedFieldsSet.has(f.toLowerCase()));
    const fieldsCorrect = testCase.expectedFields.every(f => actualFieldsSet.has(f.toLowerCase()));
    
    const fieldsPrecision = fields.length > 0 ? matchingFields.length / fields.length : 0;
    const fieldsRecall = testCase.expectedFields.length > 0 
      ? matchingFields.length / testCase.expectedFields.length 
      : 1;
    const fieldsF1 = (fieldsPrecision + fieldsRecall > 0)
      ? (2 * fieldsPrecision * fieldsRecall) / (fieldsPrecision + fieldsRecall)
      : 0;

    // Check if SOQL was generated successfully
    const soqlSuccess = result.isValid && result.soql.length > 0;

    // Calculate overall score (simplified for new architecture)
    const overallScore = (
      (objectCorrect ? 1 : 0) + 
      fieldsF1 + 
      (soqlSuccess ? 1 : 0)
    ) / 3;

    return {
      testCase,
      result: {
        mainObject: result.mainObject,
        soql: result.soql,
        fields,
        hasWhereClause: !!parsed?.whereClause,
        hasOrderBy: !!parsed?.orderBy,
        hasLimit: parsed?.limit !== undefined,
      },
      scores: {
        object: { correct: objectCorrect, score: objectCorrect ? 1 : 0 },
        fields: {
          correct: fieldsCorrect,
          precision: fieldsPrecision,
          recall: fieldsRecall,
          f1: fieldsF1,
        },
        soqlGenerated: { success: soqlSuccess, score: soqlSuccess ? 1 : 0 },
        overall: overallScore,
      },
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`Error evaluating test case "${testCase.description}":`, err);
    return {
      testCase,
      error: err.message,
      scores: {
        object: { correct: false, score: 0 },
        fields: { correct: false, precision: 0, recall: 0, f1: 0 },
        soqlGenerated: { success: false, score: 0 },
        overall: 0,
      },
    };
  }
}

/**
 * Evaluate all test cases.
 * @returns Evaluation results
 */
export async function evaluateAllTestCases(): Promise<EvaluationResult[]> {
  // Check LLM availability first
  const llmAvailable = await isLLMAvailable();
  if (!llmAvailable) {
    throw new Error(
      'LLM is required for SOQL generation evaluation. ' +
      'Please ensure Ollama is running and configured.'
    );
  }

  const results: EvaluationResult[] = [];

  for (const testCase of testCases) {
    const result = await evaluateTestCase(testCase);
    results.push(result);
  }

  return results;
}

/**
 * Evaluate test cases and compute summary statistics.
 * @returns Evaluation results with summary
 */
export async function evaluateWithSummary(): Promise<ComparisonResult> {
  const results = await evaluateAllTestCases();

  // Calculate summary statistics
  const successfulCases = results.filter(r => !r.error && r.scores.overall > 0.5).length;

  // By category
  const categories = [...new Set(testCases.map(tc => tc.category))];
  const byCategory: Record<string, { total: number; successful: number; avgScore: number }> = {};
  
  for (const category of categories) {
    const categoryResults = results.filter(r => r.testCase.category === category);
    const successful = categoryResults.filter(r => !r.error && r.scores.overall > 0.5).length;
    const avgScore = categoryResults.reduce((sum, r) => sum + r.scores.overall, 0) / categoryResults.length;
    byCategory[category] = { total: categoryResults.length, successful, avgScore };
  }

  // By difficulty
  const difficulties = [...new Set(testCases.map(tc => tc.difficulty))];
  const byDifficulty: Record<string, { total: number; successful: number; avgScore: number }> = {};
  
  for (const difficulty of difficulties) {
    const diffResults = results.filter(r => r.testCase.difficulty === difficulty);
    const successful = diffResults.filter(r => !r.error && r.scores.overall > 0.5).length;
    const avgScore = diffResults.reduce((sum, r) => sum + r.scores.overall, 0) / diffResults.length;
    byDifficulty[difficulty] = { total: diffResults.length, successful, avgScore };
  }

  // Overall
  const objectAccuracy = results.filter(r => r.scores.object.correct).length / results.length;
  const fieldsF1 = results.reduce((sum, r) => sum + r.scores.fields.f1, 0) / results.length;
  const generationSuccess = results.filter(r => r.scores.soqlGenerated.success).length / results.length;
  const overallScore = results.reduce((sum, r) => sum + r.scores.overall, 0) / results.length;

  return {
    results,
    summary: {
      totalCases: results.length,
      successfulCases,
      byCategory,
      byDifficulty,
      overall: {
        objectAccuracy,
        fieldsF1,
        generationSuccess,
        overallScore,
      },
    },
  };
}

// Keep for backward compatibility
export async function evaluateWithAndWithoutLLM(): Promise<ComparisonResult> {
  console.log('Note: LLM is now required. Running evaluation with LLM only.');
  return evaluateWithSummary();
}

/**
 * Evaluate component performance.
 * @returns Component performance evaluation
 */
export async function evaluateComponentPerformance(): Promise<ComponentEvaluationResult> {
  // Check LLM availability first
  const llmAvailable = await isLLMAvailable();
  if (!llmAvailable) {
    throw new Error('LLM is required for evaluation.');
  }

  const componentResults: ComponentEvaluationResult['components'] = {
    nlpProcessing: [],
    soqlGeneration: [],
  };

  for (const testCase of testCases) {
    try {
      console.log(`Evaluating components for test case: "${testCase.description}"`);

      // Evaluate NLP processing
      const processedQuery = await processNaturalLanguage(testCase.query, { useLLM: true });
      const nlpSuccess = processedQuery && processedQuery.llmAnalysis;

      componentResults.nlpProcessing.push({
        testCase,
        success: !!nlpSuccess,
        result: processedQuery,
      });

      // Evaluate SOQL generation
      const result = await generateSoqlFromNaturalLanguage(testCase.query);
      const soqlSuccess = result.isValid && result.soql.length > 0;

      componentResults.soqlGeneration.push({
        testCase,
        success: soqlSuccess,
        result: {
          soql: result.soql,
          mainObject: result.mainObject,
          isValid: result.isValid,
        },
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error(`Error evaluating components for test case "${testCase.description}":`, err);

      componentResults.nlpProcessing.push({
        testCase,
        success: false,
        error: err.message,
      });

      componentResults.soqlGeneration.push({
        testCase,
        success: false,
        error: err.message,
      });
    }
  }

  // Calculate success rates
  const nlpSuccessRate =
    componentResults.nlpProcessing.filter(r => r.success).length /
    componentResults.nlpProcessing.length;
  const soqlSuccessRate =
    componentResults.soqlGeneration.filter(r => r.success).length /
    componentResults.soqlGeneration.length;

  return {
    components: componentResults,
    successRates: {
      nlpProcessing: nlpSuccessRate,
      soqlGeneration: soqlSuccessRate,
      overall: (nlpSuccessRate + soqlSuccessRate) / 2,
    },
  };
}
