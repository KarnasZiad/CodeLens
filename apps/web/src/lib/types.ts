// Responses of the CodeLens API, as the dashboard reads them.

export const SEVERITIES = ['blocker', 'critical', 'major', 'minor', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];
export type GateStatus = 'passed' | 'failed';

export interface Me {
  user: { id: number; login: string; avatarUrl: string };
  repositories: number;
}

export interface Repository {
  id: number;
  fullName: string;
  private: boolean;
  openPullRequests: number;
  lastReviewAt: string | null;
  lastGate: GateStatus | null;
}

export interface RunSummary {
  id: string;
  headSha: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  gateStatus: GateStatus | null;
  conclusion: 'success' | 'failure' | 'neutral' | null;
  counts: Partial<Record<Severity, number>>;
  findingsCount: number;
  partial: boolean;
  durationMs: number | null;
  queuedAt: string;
  completedAt: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  updatedAt: string;
  latestRun: RunSummary | null;
}

export interface Finding {
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
  findings: Finding[];
}

export interface Trends {
  days: number;
  weekly: { week: string; analyzer: string; findings: number }[];
  gate: { passed: number; failed: number };
}
