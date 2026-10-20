import type { CodeLensConfig, ConfigError, ReviewResult } from '@codelens/review-engine';

/** Full report of a review, kept 90 days: what ran, with which configuration, and every finding. */
export interface ReviewReport {
  runId: string;
  repository: string;
  pullRequest: number;
  headSha: string;
  configSource: 'default' | 'file' | 'invalid';
  config: CodeLensConfig | null;
  configErrors: ConfigError[];
  result: ReviewResult | null;
  createdAt: Date;
}

export interface ReportStore {
  /** Upserts by run identifier: a retried run replaces its report. */
  save(report: ReviewReport): Promise<void>;
  find(runId: string): Promise<ReviewReport | null>;
}
