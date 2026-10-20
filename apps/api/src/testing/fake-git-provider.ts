import type { ChangedFile } from '@codelens/review-engine';
import type {
  CheckResult,
  GitProvider,
  PullRequestRef,
  RepositoryRef,
} from '../modules/github/git-provider.js';

/** A code host in memory: files per ref, and every check and comment it received. */
export class FakeGitProvider implements GitProvider {
  files: ChangedFile[] = [];
  truncated = false;
  /** Content per `${ref}:${path}`. */
  readonly contents = new Map<string, string>();
  readonly checks = new Map<
    number,
    { ref: PullRequestRef; externalId: string; result?: CheckResult }
  >();
  readonly comments: { ref: PullRequestRef; body: string }[] = [];
  readonly reads: string[] = [];
  /** Thrown by the next call to the named operation. */
  readonly failures = new Map<keyof GitProvider, Error>();
  private nextCheckId = 1000;

  private fail(operation: keyof GitProvider): void {
    const error = this.failures.get(operation);
    if (error) {
      this.failures.delete(operation);
      throw error;
    }
  }

  setContent(gitRef: string, path: string, content: string): void {
    this.contents.set(`${gitRef}:${path}`, content);
  }

  listFiles(_ref: PullRequestRef, limit: number) {
    this.fail('listFiles');
    return Promise.resolve({
      files: this.files.slice(0, limit),
      truncated: this.truncated || this.files.length > limit,
    });
  }

  readFile(_ref: RepositoryRef, path: string, gitRef: string, maxBytes: number) {
    this.fail('readFile');
    this.reads.push(`${gitRef}:${path}`);
    const content = this.contents.get(`${gitRef}:${path}`);
    return Promise.resolve(
      content === undefined || Buffer.byteLength(content) > maxBytes ? null : content,
    );
  }

  startCheck(ref: PullRequestRef, externalId: string) {
    this.fail('startCheck');
    const id = this.nextCheckId++;
    this.checks.set(id, { ref, externalId });
    return Promise.resolve(id);
  }

  completeCheck(_ref: RepositoryRef, checkRunId: number, result: CheckResult) {
    this.fail('completeCheck');
    const check = this.checks.get(checkRunId);
    if (!check) throw new Error(`Unknown check ${checkRunId}`);
    check.result = result;
    return Promise.resolve();
  }

  upsertSummaryComment(ref: PullRequestRef, body: string) {
    this.fail('upsertSummaryComment');
    const existing = this.comments.find((comment) => comment.ref.number === ref.number);
    if (existing) existing.body = body;
    else this.comments.push({ ref, body });
    return Promise.resolve();
  }

  fileUrl(ref: PullRequestRef, path: string, line?: number): string {
    return `https://github.com/${ref.owner}/${ref.repo}/blob/${ref.headSha}/${path}${line === undefined ? '' : `#L${line}`}`;
  }
}
