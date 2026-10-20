import { randomUUID } from 'node:crypto';
import type { Finding } from '@codelens/review-engine';
import type {
  Conclusion,
  InstallationRecord,
  PullRequestRecord,
  RepositoryRecord,
  ReviewRepository,
  ReviewRunRecord,
  RunContext,
  RunOutcome,
} from '../modules/reviews/review-repository.js';

export interface MemoryRun extends ReviewRunRecord {
  conclusion: Conclusion | null;
  gateStatus: 'passed' | 'failed' | null;
  findings: Finding[];
  error: string | null;
}

/** Same contract as the PostgreSQL repository, cascades included. */
export class MemoryReviewRepository implements ReviewRepository {
  readonly installations = new Map<number, InstallationRecord & { suspended: boolean }>();
  readonly repositories = new Map<number, RepositoryRecord>();
  readonly pullRequests = new Map<number, PullRequestRecord>();
  readonly runs = new Map<string, MemoryRun>();

  upsertInstallation(installation: InstallationRecord): Promise<void> {
    const suspended = this.installations.get(installation.id)?.suspended ?? false;
    this.installations.set(installation.id, { ...installation, suspended });
    return Promise.resolve();
  }

  async deleteInstallation(id: number): Promise<void> {
    this.installations.delete(id);
    const repositories = [...this.repositories.values()].filter(
      (repository) => repository.installationId === id,
    );
    await this.deleteRepositories(repositories.map((repository) => repository.id));
  }

  setInstallationSuspended(id: number, suspended: boolean): Promise<void> {
    const installation = this.installations.get(id);
    if (installation) installation.suspended = suspended;
    return Promise.resolve();
  }

  upsertRepositories(repositories: readonly RepositoryRecord[]): Promise<void> {
    for (const repository of repositories) {
      if (!this.installations.has(repository.installationId))
        throw new Error('foreign key violation');
      const known = this.repositories.get(repository.id);
      this.repositories.set(repository.id, {
        ...repository,
        defaultBranch: repository.defaultBranch ?? known?.defaultBranch ?? null,
      });
    }
    return Promise.resolve();
  }

  deleteRepositories(ids: readonly number[]): Promise<void> {
    for (const id of ids) {
      this.repositories.delete(id);
      for (const pullRequest of [...this.pullRequests.values()]) {
        if (pullRequest.repositoryId !== id) continue;
        this.pullRequests.delete(pullRequest.id);
        for (const run of [...this.runs.values()]) {
          if (run.pullRequestId === pullRequest.id) this.runs.delete(run.id);
        }
      }
    }
    return Promise.resolve();
  }

  upsertPullRequest(pullRequest: PullRequestRecord): Promise<void> {
    if (!this.repositories.has(pullRequest.repositoryId)) throw new Error('foreign key violation');
    this.pullRequests.set(pullRequest.id, { ...pullRequest });
    return Promise.resolve();
  }

  createRun(pullRequestId: number, headSha: string) {
    const existing = [...this.runs.values()].find(
      (run) => run.pullRequestId === pullRequestId && run.headSha === headSha,
    );
    if (existing) return Promise.resolve({ run: { ...existing }, created: false });
    const run: MemoryRun = {
      id: randomUUID(),
      pullRequestId,
      headSha,
      status: 'queued',
      checkRunId: null,
      conclusion: null,
      gateStatus: null,
      findings: [],
      error: null,
    };
    this.runs.set(run.id, run);
    return Promise.resolve({ run: { ...run }, created: true });
  }

  findRunContext(runId: string): Promise<RunContext | null> {
    const run = this.runs.get(runId);
    const pullRequest = run && this.pullRequests.get(run.pullRequestId);
    const repository = pullRequest && this.repositories.get(pullRequest.repositoryId);
    if (!run || !pullRequest || !repository) return Promise.resolve(null);
    const { id, headSha, status, checkRunId } = run;
    return Promise.resolve({
      run: { id, pullRequestId: run.pullRequestId, headSha, status, checkRunId },
      pullRequest: { ...pullRequest },
      repository: { ...repository },
    });
  }

  private run(runId: string): MemoryRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    return run;
  }

  startRun(runId: string): Promise<void> {
    this.run(runId).status = 'running';
    return Promise.resolve();
  }

  setCheckRun(runId: string, checkRunId: number): Promise<void> {
    this.run(runId).checkRunId = checkRunId;
    return Promise.resolve();
  }

  completeRun(runId: string, { conclusion, result }: RunOutcome): Promise<void> {
    Object.assign(this.run(runId), {
      status: 'completed',
      conclusion,
      gateStatus: result?.gate.status ?? null,
      findings: result?.findings ?? [],
      error: null,
    });
    return Promise.resolve();
  }

  failRun(runId: string, error: string): Promise<void> {
    Object.assign(this.run(runId), { status: 'failed', conclusion: 'neutral', error });
    return Promise.resolve();
  }
}
