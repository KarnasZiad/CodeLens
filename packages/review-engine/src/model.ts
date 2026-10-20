/** Severities from the least to the most serious. The order drives sorting and the quality gate. */
export const SEVERITIES = ['info', 'minor', 'major', 'critical', 'blocker'] as const;
export type Severity = (typeof SEVERITIES)[number];

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  info: 'Info',
  minor: 'Mineur',
  major: 'Majeur',
  critical: 'Critique',
  blocker: 'Bloquant',
};

/** File statuses as reported by the GitHub pull request files API. */
export type FileStatus =
  'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunks; absent for binary files and for diffs too large for the provider. */
  patch?: string;
}

export interface Finding {
  analyzer: string;
  rule: string;
  severity: Severity;
  /** Shown to developers: states the problem and the expected fix, never a secret value. */
  message: string;
  /** Absent for findings about the pull request as a whole. */
  path?: string;
  line?: number;
  endLine?: number;
}

export interface PullRequestInfo {
  title: string;
  author: string;
  baseRef: string;
  headRef: string;
}

export interface ReviewInput {
  pullRequest: PullRequestInfo;
  files: readonly ChangedFile[];
  /** Head contents of the files the analyzers asked for, keyed by path. */
  contents?: ReadonlyMap<string, string>;
  /** True when the provider listed fewer files than the pull request contains. */
  truncated?: boolean;
}
