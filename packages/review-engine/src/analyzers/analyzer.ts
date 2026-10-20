import type { AnalyzerId, CodeLensConfig } from '../config.js';
import type { AddedLine, Hunk } from '../diff/patch.js';
import type { ChangedFile, Finding, PullRequestInfo } from '../model.js';
import type { Language } from '../paths.js';

/** Lines longer than this are skipped by line-based rules: minified code or embedded data. */
export const MAX_LINE_LENGTH = 1000;

export interface AnalyzedFile extends ChangedFile {
  hunks: Hunk[];
  added: AddedLine[];
  language: Language | null;
  isTest: boolean;
}

export interface AnalysisContext {
  readonly pullRequest: PullRequestInfo;
  /** Files to analyze: removed and ignored files are left out. */
  readonly files: readonly AnalyzedFile[];
  readonly config: CodeLensConfig;
  /** Head content of a file, when an analyzer asked for it and the worker could load it. */
  content(path: string): string | undefined;
}

/**
 * A review rule set (Strategy pattern). Analyzers are pure: no I/O, no execution of the analyzed
 * code. They report findings on added lines only, unless the rule is about the pull request itself.
 */
export interface Analyzer {
  readonly id: AnalyzerId;
  readonly description: string;
  /** Files whose head content must be loaded before the run. */
  needsContent?(file: AnalyzedFile, config: CodeLensConfig): boolean;
  analyze(context: AnalysisContext): Finding[];
}

/** Added lines worth matching: not too long to be scanned safely. */
export function scannableLines(file: AnalyzedFile): AddedLine[] {
  return file.added.filter((line) => line.content.length <= MAX_LINE_LENGTH);
}

export function isCommentLine(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('#')
  );
}
