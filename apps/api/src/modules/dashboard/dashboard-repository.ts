import type { Severity } from '@codelens/review-engine';
import type { Conclusion, PullRequestState, RunStatus } from '../reviews/review-repository.js';

export interface RepositorySummary {
  id: number;
  fullName: string;
  private: boolean;
  openPullRequests: number;
  lastReviewAt: string | null;
  lastGate: 'passed' | 'failed' | null;
}

export interface RunSummary {
  id: string;
  headSha: string;
  status: RunStatus;
  gateStatus: 'passed' | 'failed' | null;
  conclusion: Conclusion | null;
  counts: Partial<Record<Severity, number>>;
  findingsCount: number;
  partial: boolean;
  durationMs: number | null;
  queuedAt: string;
  completedAt: string | null;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  state: PullRequestState;
  draft: boolean;
  updatedAt: string;
  latestRun: RunSummary | null;
}

export interface FindingRow {
  analyzer: string;
  rule: string;
  severity: Severity;
  path: string | null;
  line: number | null;
  endLine: number | null;
  message: string;
}

export interface RunDetail extends RunSummary {
  repository: { id: number; fullName: string };
  pullRequest: { number: number; title: string; author: string };
  findings: FindingRow[];
}

export interface Trends {
  days: number;
  /** Findings per analyzer and per ISO week (Monday, YYYY-MM-DD). */
  weekly: { week: string; analyzer: string; findings: number }[];
  gate: { passed: number; failed: number };
}

/** Read side of the dashboard. Every method returns explicit projections, never whole rows. */
export interface DashboardRepository {
  listRepositories(ids: readonly number[]): Promise<RepositorySummary[]>;
  findRepository(fullName: string): Promise<{ id: number; fullName: string } | null>;
  listPullRequests(repositoryId: number, state: 'open' | 'all'): Promise<PullRequestSummary[]>;
  findRun(runId: string): Promise<RunDetail | null>;
  trends(repositoryId: number, days: number): Promise<Trends>;
}
