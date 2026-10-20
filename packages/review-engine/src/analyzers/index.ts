import type { Analyzer } from './analyzer.js';
import { complexityAnalyzer } from './complexity.js';
import { debugStatementsAnalyzer } from './debug-statements.js';
import { dependenciesAnalyzer } from './dependencies.js';
import { missingTestsAnalyzer, prSizeAnalyzer, todoCommentsAnalyzer } from './pull-request.js';
import { secretsAnalyzer } from './secrets.js';
import { sqlInjectionAnalyzer } from './sql-injection.js';

/** Every built-in analyzer, in the order their findings are listed at equal severity. */
export const DEFAULT_ANALYZERS: readonly Analyzer[] = [
  secretsAnalyzer,
  sqlInjectionAnalyzer,
  debugStatementsAnalyzer,
  complexityAnalyzer,
  dependenciesAnalyzer,
  prSizeAnalyzer,
  missingTestsAnalyzer,
  todoCommentsAnalyzer,
];

export type { AnalysisContext, AnalyzedFile, Analyzer } from './analyzer.js';
export { functionComplexities } from './complexity.js';
export { entropy } from './secrets.js';
