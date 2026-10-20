import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../infrastructure/database.js';
import {
  findings,
  installations,
  pullRequests,
  repositories,
  reviewRuns,
} from '../../infrastructure/schema.js';
import type {
  InstallationRecord,
  PullRequestRecord,
  RepositoryRecord,
  ReviewRepository,
  ReviewRunRecord,
  RunContext,
  RunOutcome,
} from './review-repository.js';

const runColumns = {
  id: reviewRuns.id,
  pullRequestId: reviewRuns.pullRequestId,
  headSha: reviewRuns.headSha,
  status: reviewRuns.status,
  checkRunId: reviewRuns.checkRunId,
};

export class PostgresReviewRepository implements ReviewRepository {
  constructor(private readonly db: Database) {}

  async upsertInstallation(installation: InstallationRecord): Promise<void> {
    await this.db
      .insert(installations)
      .values(installation)
      .onConflictDoUpdate({
        target: installations.id,
        set: {
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          updatedAt: sql`now()`,
        },
      });
  }

  async deleteInstallation(id: number): Promise<void> {
    await this.db.delete(installations).where(eq(installations.id, id));
  }

  async setInstallationSuspended(id: number, suspended: boolean): Promise<void> {
    await this.db
      .update(installations)
      .set({ suspendedAt: suspended ? sql`now()` : null, updatedAt: sql`now()` })
      .where(eq(installations.id, id));
  }

  async upsertRepositories(records: readonly RepositoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db
      .insert(repositories)
      .values(records.map((record) => ({ ...record, defaultBranch: record.defaultBranch ?? null })))
      .onConflictDoUpdate({
        target: repositories.id,
        set: {
          installationId: sql`excluded.installation_id`,
          fullName: sql`excluded.full_name`,
          private: sql`excluded.private`,
          // A payload without the branch keeps the one already known.
          defaultBranch: sql`coalesce(excluded.default_branch, ${repositories.defaultBranch})`,
          updatedAt: sql`now()`,
        },
      });
  }

  async deleteRepositories(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(repositories).where(inArray(repositories.id, [...ids]));
  }

  async upsertPullRequest(pullRequest: PullRequestRecord): Promise<void> {
    const { id: _id, ...changes } = pullRequest;
    await this.db
      .insert(pullRequests)
      .values(pullRequest)
      .onConflictDoUpdate({ target: pullRequests.id, set: { ...changes, updatedAt: sql`now()` } });
  }

  async createRun(pullRequestId: number, headSha: string) {
    const [inserted] = await this.db
      .insert(reviewRuns)
      .values({ pullRequestId, headSha })
      .onConflictDoNothing({ target: [reviewRuns.pullRequestId, reviewRuns.headSha] })
      .returning(runColumns);
    if (inserted) return { run: inserted, created: true };
    const [existing] = await this.db
      .select(runColumns)
      .from(reviewRuns)
      .where(and(eq(reviewRuns.pullRequestId, pullRequestId), eq(reviewRuns.headSha, headSha)));
    if (!existing) throw new Error('Review run vanished during creation');
    return { run: existing, created: false };
  }

  async findRunContext(runId: string): Promise<RunContext | null> {
    const [row] = await this.db
      .select({ run: runColumns, pullRequest: pullRequests, repository: repositories })
      .from(reviewRuns)
      .innerJoin(pullRequests, eq(pullRequests.id, reviewRuns.pullRequestId))
      .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
      .where(eq(reviewRuns.id, runId));
    if (!row) return null;
    const run: ReviewRunRecord = row.run;
    const { createdAt: _c, updatedAt: _u, ...pullRequest } = row.pullRequest;
    const { createdAt: _rc, updatedAt: _ru, ...repository } = row.repository;
    return {
      run,
      pullRequest: { ...pullRequest, state: pullRequest.state as PullRequestRecord['state'] },
      repository,
    };
  }

  async startRun(runId: string): Promise<void> {
    await this.db
      .update(reviewRuns)
      .set({
        status: 'running',
        startedAt: sql`coalesce(${reviewRuns.startedAt}, now())`,
        error: null,
      })
      .where(eq(reviewRuns.id, runId));
  }

  async setCheckRun(runId: string, checkRunId: number): Promise<void> {
    await this.db.update(reviewRuns).set({ checkRunId }).where(eq(reviewRuns.id, runId));
  }

  async completeRun(runId: string, { conclusion, result }: RunOutcome): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Replaced, not appended: a retried review must not duplicate its findings.
      await tx.delete(findings).where(eq(findings.runId, runId));
      if (result && result.findings.length > 0) {
        await tx.insert(findings).values(
          result.findings.map((finding) => ({
            runId,
            analyzer: finding.analyzer,
            rule: finding.rule,
            severity: finding.severity,
            path: finding.path ?? null,
            line: finding.line ?? null,
            endLine: finding.endLine ?? null,
            message: finding.message,
          })),
        );
      }
      await tx
        .update(reviewRuns)
        .set({
          status: 'completed',
          conclusion,
          gateStatus: result?.gate.status ?? null,
          counts: result?.counts ?? {},
          findingsCount: result
            ? Object.values(result.counts).reduce((sum, count) => sum + count, 0)
            : 0,
          partial: result?.stats.partial ?? false,
          durationMs: result ? Math.round(result.durationMs) : null,
          completedAt: sql`now()`,
          error: null,
        })
        .where(eq(reviewRuns.id, runId));
    });
  }

  async failRun(runId: string, error: string): Promise<void> {
    await this.db
      .update(reviewRuns)
      .set({ status: 'failed', conclusion: 'neutral', error, completedAt: sql`now()` })
      .where(eq(reviewRuns.id, runId));
  }
}
