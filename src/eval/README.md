# Natural Language to SOQL Evaluation Framework

This directory contains an evaluation framework for assessing the performance of the natural language to SOQL generation capabilities.

## Overview

The evaluation framework measures:

1. **Accuracy**: How well the generated SOQL matches the intended query
2. **Robustness**: How well it handles different phrasings and edge cases
3. **Component Performance**: How each component (NLP processing, entity recognition, condition extraction) performs
4. **LLM vs. Non-LLM Comparison**: Comparing results with and without LLM assistance

## Files

- `test-cases.js`: Contains test cases for evaluation
- `evaluator.js`: Contains the evaluation logic
- `run-evaluation.js`: Script to run the evaluation and generate reports

## Test Cases

Test cases are defined in `test-cases.js` and include:

- Basic queries
- Queries with sorting and limiting
- Complex queries with multiple conditions
- Queries with specific field selection
- Edge cases and challenging queries
- Queries with different phrasings
- Queries with typos or informal language

Each test case includes:

- Description
- Natural language query
- Expected Salesforce object
- Expected fields
- Expected conditions
- Expected ORDER BY clause
- Expected LIMIT clause
- Difficulty level (easy, medium, hard)
- Category (basic, complex, edge case)

## Evaluation Metrics

The evaluation framework calculates the following metrics:

- **Object Identification**: Whether the correct Salesforce object was identified
- **Field Selection**: Precision, recall, and F1 score for field selection
- **Condition Extraction**: Precision, recall, and F1 score for condition extraction
- **Order By**: Whether the correct ORDER BY clause was generated
- **Limit**: Whether the correct LIMIT clause was generated
- **Overall Score**: A weighted average of all metrics

## Running the Evaluation

To run the evaluation:

```bash
./run-eval.sh
```

This will:

1. Check if Ollama is running (for LLM evaluation)
2. Run the evaluation with and without LLM
3. Generate reports in the `reports` directory

## Reports

The evaluation generates the following reports:

- `comparative-evaluation.md`: Comparison of performance with and without LLM
- `component-evaluation-with-llm.md`: Component performance with LLM
- `component-evaluation-without-llm.md`: Component performance without LLM

## Extending the Evaluation

To add more test cases, edit `test-cases.js` and add new test case objects to the `testCases` array.

To add new evaluation metrics, modify the `evaluateTestCase` function in `evaluator.js`.

## Interpreting Results

The reports provide detailed information about the performance of the natural language to SOQL generation capabilities. Key things to look for:

- **Overall improvement with LLM**: How much does the LLM improve overall performance?
- **Component-specific improvements**: Which components benefit most from the LLM?
- **Performance by category**: How does performance vary across different types of queries?
- **Performance by difficulty**: How does performance vary across different difficulty levels?
- **Specific test case failures**: Which test cases are failing and why?
