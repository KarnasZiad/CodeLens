import type { Severity } from '@codelens/review-engine';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../infrastructure/database.js';
import { findings, pullRequests, repositories, reviewRuns } from '../../infrastructure/schema.js';
import type { Conclusion, PullRequestState, RunStatus } from '../reviews/review-repository.js';
import type {
  DashboardRepository,
  PullRequestSummary,
  RepositorySummary,
  RunDetail,
  RunSummary,
  Trends,
} from './dashboard-repository.js';

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

// A type, not an interface: db.execute() requires rows assignable to Record<string, unknown>.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type RunRow = {
  run_id: string | null;
  head_sha: string;
  status: RunStatus;
  gate_status: 'passed' | 'failed' | null;
  conclusion: Conclusion | null;
  counts: Partial<Record<Severity, number>>;
  findings_count: number;
  partial: boolean;
  duration_ms: number | null;
  queued_at: Date;
  completed_at: Date | null;
};

function toRunSummary(row: RunRow & { run_id: string }): RunSummary {
  return {
    id: row.run_id,
    headSha: row.head_sha,
    status: row.status,
    gateStatus: row.gate_status,
    conclusion: row.conclusion,
    counts: row.counts,
    findingsCount: row.findings_count,
    partial: row.partial,
    durationMs: row.duration_ms,
    queuedAt: new Date(row.queued_at).toISOString(),
    completedAt: iso(row.completed_at),
  };
}

const SEVERITY_ORDER = sql`array_position(array['blocker','critical','major','minor','info']::severity[], ${findings.severity})`;

export class PostgresDashboardRepository implements DashboardRepository {
  constructor(private readonly db: Database) {}

  async listRepositories(ids: readonly number[]): Promise<RepositorySummary[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.execute<{
      id: string;
      full_name: string;
      private: boolean;
      open_pull_requests: number;
      last_review_at: Date | null;
      last_gate: 'passed' | 'failed' | null;
    }>(sql`
      select r.id, r.full_name, r.private,
        (select count(*)::int from pull_requests p
          where p.repository_id = r.id and p.state = 'open') as open_pull_requests,
        last.completed_at as last_review_at, last.gate_status as last_gate
      from repositories r
      left join lateral (
        select rr.completed_at, rr.gate_status
        from review_runs rr join pull_requests p on p.id = rr.pull_request_id
        where p.repository_id = r.id and rr.status = 'completed'
        order by rr.completed_at desc limit 1
      ) last on true
      where r.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by r.full_name`);
    return rows.map((row) => ({
      id: Number(row.id),
      fullName: row.full_name,
      private: row.private,
      openPullRequests: row.open_pull_requests,
      lastReviewAt: iso(row.last_review_at),
      lastGate: row.last_gate,
    }));
  }

  async findRepository(fullName: string) {
    const [row] = await this.db
      .select({ id: repositories.id, fullName: repositories.fullName })
      .from(repositories)
      .where(eq(repositories.fullName, fullName));
    return row ?? null;
  }

  async listPullRequests(
    repositoryId: number,
    state: 'open' | 'all',
  ): Promise<PullRequestSummary[]> {
    const { rows } = await this.db.execute<
      RunRow & {
        number: number;
        title: string;
        author_login: string;
        state: PullRequestState;
        draft: boolean;
        updated_at: Date;
      }
    >(sql`
      select p.number, p.title, p.author_login, p.state, p.draft, p.updated_at,
        lr.id as run_id, lr.head_sha, lr.status, lr.gate_status, lr.conclusion, lr.counts,
        lr.findings_count, lr.partial, lr.duration_ms, lr.queued_at, lr.completed_at
      from pull_requests p
      left join lateral (
        select * from review_runs rr where rr.pull_request_id = p.id
        order by rr.queued_at desc limit 1
      ) lr on true
      where p.repository_id = ${repositoryId} ${state === 'open' ? sql`and p.state = 'open'` : sql``}
      order by p.updated_at desc
      limit 100`);
    return rows.map((row) => ({
      number: row.number,
      title: row.title,
      author: row.author_login,
      state: row.state,
      draft: row.draft,
      updatedAt: new Date(row.updated_at).toISOString(),
      latestRun: row.run_id === null ? null : toRunSummary({ ...row, run_id: row.run_id }),
    }));
  }

  async findRun(runId: string): Promise<RunDetail | null> {
    const [row] = await this.db
      .select({
        run: reviewRuns,
        repository: { id: repositories.id, fullName: repositories.fullName },
        pullRequest: {
          number: pullRequests.number,
          title: pullRequests.title,
          author: pullRequests.authorLogin,
        },
      })
      .from(reviewRuns)
      .innerJoin(pullRequests, eq(pullRequests.id, reviewRuns.pullRequestId))
      .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
      .where(eq(reviewRuns.id, runId));
    if (!row) return null;

    const rows = await this.db
      .select({
        analyzer: findings.analyzer,
        rule: findings.rule,
        severity: findings.severity,
        path: findings.path,
        line: findings.line,
        endLine: findings.endLine,
        message: findings.message,
      })
      .from(findings)
      .where(eq(findings.runId, runId))
      .orderBy(SEVERITY_ORDER, sql`${findings.path} nulls first`, findings.line);

    const { run } = row;
    return {
      id: run.id,
      headSha: run.headSha,
      status: run.status,
      gateStatus: run.gateStatus,
      conclusion: run.conclusion,
      counts: run.counts,
      findingsCount: run.findingsCount,
      partial: run.partial,
      durationMs: run.durationMs,
      queuedAt: run.queuedAt.toISOString(),
      completedAt: iso(run.completedAt),
      repository: row.repository,
      pullRequest: row.pullRequest,
      findings: rows,
    };
  }

  async trends(repositoryId: number, days: number): Promise<Trends> {
    const since = sql`now() - ${days}::int * interval '1 day'`;
    const weekly = await this.db.execute<{ week: string; analyzer: string; findings: number }>(sql`
      select to_char(date_trunc('week', rr.completed_at), 'YYYY-MM-DD') as week,
        f.analyzer, count(*)::int as findings
      from findings f
      join review_runs rr on rr.id = f.run_id
      join pull_requests p on p.id = rr.pull_request_id
      where p.repository_id = ${repositoryId} and rr.completed_at >= ${since}
      group by 1, 2
      order by 1, 2`);
    const gate = await this.db.execute<{ passed: number; failed: number }>(sql`
      select count(*) filter (where rr.gate_status = 'passed')::int as passed,
        count(*) filter (where rr.gate_status = 'failed')::int as failed
      from review_runs rr join pull_requests p on p.id = rr.pull_request_id
      where p.repository_id = ${repositoryId} and rr.completed_at >= ${since}`);
    return {
      days,
      weekly: weekly.rows,
      gate: gate.rows[0] ?? { passed: 0, failed: 0 },
    };
  }
}
