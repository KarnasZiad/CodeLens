import type {
  DashboardRepository,
  PullRequestSummary,
  RepositorySummary,
  RunDetail,
  Trends,
} from '../modules/dashboard/dashboard-repository.js';

/** Canned dashboard data; the SQL behind the real repository is covered by integration tests. */
export class MemoryDashboardRepository implements DashboardRepository {
  repositories: RepositorySummary[] = [
    {
      id: 1001,
      fullName: 'acme/shop',
      private: true,
      openPullRequests: 1,
      lastReviewAt: '2026-10-20T10:00:00.000Z',
      lastGate: 'failed',
    },
    {
      id: 1002,
      fullName: 'acme/secret-project',
      private: true,
      openPullRequests: 3,
      lastReviewAt: null,
      lastGate: null,
    },
  ];
  pullRequests = new Map<number, PullRequestSummary[]>();
  runs = new Map<string, RunDetail>();

  listRepositories(ids: readonly number[]) {
    return Promise.resolve(this.repositories.filter((repository) => ids.includes(repository.id)));
  }

  findRepository(fullName: string) {
    const repository = this.repositories.find((item) => item.fullName === fullName);
    return Promise.resolve(
      repository ? { id: repository.id, fullName: repository.fullName } : null,
    );
  }

  listPullRequests(repositoryId: number, state: 'open' | 'all') {
    const all = this.pullRequests.get(repositoryId) ?? [];
    return Promise.resolve(state === 'all' ? all : all.filter((pull) => pull.state === 'open'));
  }

  findRun(runId: string) {
    return Promise.resolve(this.runs.get(runId) ?? null);
  }

  trends(_repositoryId: number, days: number): Promise<Trends> {
    return Promise.resolve({
      days,
      weekly: [{ week: '2026-10-19', analyzer: 'secrets', findings: 2 }],
      gate: { passed: 3, failed: 1 },
    });
  }
}
