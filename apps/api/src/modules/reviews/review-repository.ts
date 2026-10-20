import type { ReviewResult } from '@codelens/review-engine';

export interface InstallationRecord {
  id: number;
  accountLogin: string;
  accountType: string;
}

export interface RepositoryRecord {
  id: number;
  installationId: number;
  fullName: string;
  private: boolean;
  defaultBranch?: string | null;
}

export type PullRequestState = 'open' | 'closed' | 'merged';

export interface PullRequestRecord {
  id: number;
  repositoryId: number;
  number: number;
  title: string;
  authorLogin: string;
  state: PullRequestState;
  draft: boolean;
  headSha: string;
  baseRef: string;
  headRef: string;
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';
export type Conclusion = 'success' | 'failure' | 'neutral';

export interface ReviewRunRecord {
  id: string;
  pullRequestId: number;
  headSha: string;
  status: RunStatus;
  checkRunId: number | null;
}

export interface RunContext {
  run: ReviewRunRecord;
  /** Current state of the pull request: its head may have moved since the run was queued. */
  pullRequest: PullRequestRecord;
  repository: RepositoryRecord;
}

/** What a finished review stores; `result` is absent when the configuration was invalid. */
export interface RunOutcome {
  conclusion: Conclusion;
  result: ReviewResult | null;
}

/** Persistence of installations, pull requests and reviews (PostgreSQL in production). */
export interface ReviewRepository {
  upsertInstallation(installation: InstallationRecord): Promise<void>;
  /** Cascades to repositories, pull requests, reviews and findings. */
  deleteInstallation(id: number): Promise<void>;
  setInstallationSuspended(id: number, suspended: boolean): Promise<void>;
  upsertRepositories(repositories: readonly RepositoryRecord[]): Promise<void>;
  deleteRepositories(ids: readonly number[]): Promise<void>;
  upsertPullRequest(pullRequest: PullRequestRecord): Promise<void>;
  /** One run per (pull request, commit): returns the existing one when it was already created. */
  createRun(
    pullRequestId: number,
    headSha: string,
  ): Promise<{ run: ReviewRunRecord; created: boolean }>;
  findRunContext(runId: string): Promise<RunContext | null>;
  startRun(runId: string): Promise<void>;
  setCheckRun(runId: string, checkRunId: number): Promise<void>;
  /** Replaces the findings of the run and marks it completed. */
  completeRun(runId: string, outcome: RunOutcome): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
}
