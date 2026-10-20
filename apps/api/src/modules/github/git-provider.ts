import type { ChangedFile } from '@codelens/review-engine';

export interface RepositoryRef {
  installationId: number;
  owner: string;
  repo: string;
}

export interface PullRequestRef extends RepositoryRef {
  number: number;
  headSha: string;
}

export interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  title: string;
  message: string;
}

export interface CheckResult {
  conclusion: 'success' | 'failure' | 'neutral';
  title: string;
  summary: string;
  annotations: readonly Annotation[];
}

/**
 * The code host, seen by the worker. GitHub implements it today; a GitLab adapter would map merge
 * requests, commit statuses and discussions onto the same operations.
 */
export interface GitProvider {
  /** Changed files of the pull request, at most `limit`. */
  listFiles(
    ref: PullRequestRef,
    limit: number,
  ): Promise<{ files: ChangedFile[]; truncated: boolean }>;
  /** Text content of a file at a ref; null when absent, binary or larger than `maxBytes`. */
  readFile(
    ref: RepositoryRef,
    path: string,
    gitRef: string,
    maxBytes: number,
  ): Promise<string | null>;
  /** Creates the "CodeLens" check in progress and returns its identifier. */
  startCheck(ref: PullRequestRef, externalId: string): Promise<number>;
  completeCheck(ref: RepositoryRef, checkRunId: number, result: CheckResult): Promise<void>;
  /** Creates the summary comment, or updates the one CodeLens posted before. */
  upsertSummaryComment(ref: PullRequestRef, body: string): Promise<void>;
  /** Link to a line of a file at the reviewed commit. */
  fileUrl(ref: PullRequestRef, path: string, line?: number): string;
}

/** The host asked to slow down: the job is postponed without consuming an attempt. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Rate limited for ${retryAfterMs} ms`);
    this.name = 'RateLimitedError';
  }
}

/** Retrying cannot help (repository gone, permission removed): the run fails at once. */
export class PermanentProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PermanentProviderError';
  }
}
