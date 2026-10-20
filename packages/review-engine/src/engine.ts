import type { AnalysisContext, AnalyzedFile, Analyzer } from './analyzers/analyzer.js';
import { DEFAULT_ANALYZERS } from './analyzers/index.js';
import { CONFIG_PATH, type CodeLensConfig } from './config.js';
import { addedLines, parsePatch } from './diff/patch.js';
import { countBySeverity, evaluateGate, type GateResult, type SeverityCounts } from './gate.js';
import { type ChangedFile, type Finding, type ReviewInput, severityRank } from './model.js';
import { globMatcher, isTestFile, languageOf } from './paths.js';

/** Findings kept per review; beyond, the most serious ones are kept and the report says so. */
export const MAX_FINDINGS = 500;

export interface AnalyzerRun {
  id: string;
  durationMs: number;
  findings: number;
  /** Set when the analyzer threw: its rules were not applied. */
  error?: string;
}

export interface ReviewStats {
  files: number;
  analyzedFiles: number;
  ignoredFiles: number;
  additions: number;
  deletions: number;
  /** The provider listed fewer files than the PR has, or findings were capped. */
  partial: boolean;
}

export interface ReviewResult {
  findings: Finding[];
  counts: SeverityCounts;
  gate: GateResult;
  analyzers: AnalyzerRun[];
  stats: ReviewStats;
  durationMs: number;
}

export interface EngineOptions {
  analyzers?: readonly Analyzer[];
  now?: () => number;
}

function prepare(file: ChangedFile): AnalyzedFile {
  const hunks = file.patch === undefined ? [] : parsePatch(file.patch);
  return {
    ...file,
    hunks,
    added: addedLines(hunks),
    language: languageOf(file.path),
    isTest: isTestFile(file.path),
  };
}

function selectFiles(files: readonly ChangedFile[], config: CodeLensConfig) {
  const ignored = globMatcher(config.ignore);
  const kept = files.filter((file) => file.status !== 'removed' && !ignored(file.path));
  return { kept, ignoredCount: files.filter((file) => ignored(file.path)).length };
}

function enabledAnalyzers(analyzers: readonly Analyzer[], config: CodeLensConfig): Analyzer[] {
  return analyzers.filter((analyzer) => config.analyzers[analyzer.id].enabled);
}

/** Paths whose head content the enabled analyzers need; the caller loads them before the run. */
export function filesNeedingContent(
  files: readonly ChangedFile[],
  config: CodeLensConfig,
  analyzers: readonly Analyzer[] = DEFAULT_ANALYZERS,
): string[] {
  const active = enabledAnalyzers(analyzers, config).filter(
    (analyzer) => analyzer.needsContent !== undefined,
  );
  if (active.length === 0) return [];
  return selectFiles(files, config)
    .kept.map(prepare)
    .filter((file) => active.some((analyzer) => analyzer.needsContent?.(file, config)))
    .map((file) => file.path);
}

function compare(a: Finding, b: Finding): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.rule.localeCompare(b.rule)
  );
}

function deduplicate(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [finding.analyzer, finding.rule, finding.path, finding.line, finding.message].join(
      '\u0000',
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Runs the enabled analyzers on the changed files and applies the quality gate. An analyzer that
 * throws is isolated: it yields an `info` finding and the others still run.
 */
export function runReview(
  input: ReviewInput,
  config: CodeLensConfig,
  { analyzers = DEFAULT_ANALYZERS, now = () => performance.now() }: EngineOptions = {},
): ReviewResult {
  const started = now();
  const { kept, ignoredCount } = selectFiles(input.files, config);
  const files = kept.map(prepare);
  const context: AnalysisContext = {
    pullRequest: input.pullRequest,
    files,
    config,
    content: (path) => input.contents?.get(path),
  };

  const runs: AnalyzerRun[] = [];
  const collected: Finding[] = [];
  for (const analyzer of enabledAnalyzers(analyzers, config)) {
    const analyzerStarted = now();
    try {
      const findings = analyzer.analyze(context);
      collected.push(...findings);
      runs.push({
        id: analyzer.id,
        durationMs: now() - analyzerStarted,
        findings: findings.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runs.push({
        id: analyzer.id,
        durationMs: now() - analyzerStarted,
        findings: 0,
        error: message,
      });
      collected.push({
        analyzer: analyzer.id,
        rule: 'analyzer-error',
        severity: 'info',
        message: `L’analyseur « ${analyzer.id} » a échoué : ses règles n’ont pas été appliquées à cette PR.`,
      });
    }
  }

  if (input.files.some((file) => file.path === CONFIG_PATH && file.status !== 'removed')) {
    collected.push({
      analyzer: 'codelens',
      rule: 'config-changed',
      severity: 'info',
      message: `Cette PR modifie ${CONFIG_PATH} : la configuration appliquée ici est celle de la branche de base, la nouvelle s’appliquera après la fusion.`,
      path: CONFIG_PATH,
    });
  }

  const all = deduplicate(collected).sort(compare);
  const findings = all.slice(0, MAX_FINDINGS);
  return {
    findings,
    counts: countBySeverity(all),
    gate: evaluateGate(all, config.gate),
    analyzers: runs,
    stats: {
      files: input.files.length,
      analyzedFiles: files.length,
      ignoredFiles: ignoredCount,
      additions: input.files.reduce((total, file) => total + file.additions, 0),
      deletions: input.files.reduce((total, file) => total + file.deletions, 0),
      partial: input.truncated === true || all.length > findings.length,
    },
    durationMs: now() - started,
  };
}
