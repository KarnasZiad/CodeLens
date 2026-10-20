import { runReview, DEFAULT_CONFIG } from '@codelens/review-engine';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDatabase, runMigrations } from '../../src/infrastructure/database.js';
import { PostgresReviewRepository } from '../../src/modules/reviews/review-repository.postgres.js';

const { db, pool } = createDatabase(inject('postgresUrl'));
const reviews = new PostgresReviewRepository(db);
const SHA = 'c'.repeat(40);

async function seed() {
  await reviews.upsertInstallation({ id: 42, accountLogin: 'acme', accountType: 'Organization' });
  await reviews.upsertRepositories([
    { id: 1001, installationId: 42, fullName: 'acme/shop', private: true, defaultBranch: 'main' },
  ]);
  await reviews.upsertPullRequest({
    id: 5001,
    repositoryId: 1001,
    number: 7,
    title: 'Add the cart',
    authorLogin: 'amina',
    state: 'open',
    draft: false,
    headSha: SHA,
    baseRef: 'main',
    headRef: 'feat/cart',
  });
}

beforeEach(async () => {
  await db.execute(sql`truncate installations cascade`);
  await seed();
});

afterAll(async () => {
  await pool.end();
});

describe('migrations', () => {
  it('can run concurrently: the advisory lock serializes them', async () => {
    await expect(
      Promise.all([runMigrations(pool), runMigrations(pool), runMigrations(pool)]),
    ).resolves.toBeDefined();
    const { rows } = await pool.query<{ count: string }>(
      'select count(*) from drizzle.__drizzle_migrations',
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });
});

describe('PostgresReviewRepository', () => {
  it('creates one run per commit, even under concurrent deliveries', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reviews.createRun(5001, SHA)),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.run.id)).size).toBe(1);
  });

  it('returns the run context with the current state of the pull request', async () => {
    const { run } = await reviews.createRun(5001, SHA);
    await reviews.upsertPullRequest({
      id: 5001,
      repositoryId: 1001,
      number: 7,
      title: 'Add the cart (v2)',
      authorLogin: 'amina',
      state: 'open',
      draft: false,
      headSha: 'd'.repeat(40),
      baseRef: 'main',
      headRef: 'feat/cart',
    });

    const context = await reviews.findRunContext(run.id);
    expect(context).toEqual({
      run: { id: run.id, pullRequestId: 5001, headSha: SHA, status: 'queued', checkRunId: null },
      pullRequest: expect.objectContaining({ title: 'Add the cart (v2)', headSha: 'd'.repeat(40) }),
      repository: expect.objectContaining({
        fullName: 'acme/shop',
        installationId: 42,
        defaultBranch: 'main',
      }),
    });
    expect(await reviews.findRunContext('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('replaces the findings of a retried run and stores the verdict', async () => {
    const { run } = await reviews.createRun(5001, SHA);
    await reviews.startRun(run.id);
    await reviews.setCheckRun(run.id, 9_007_199_254_740);
    const result = runReview(
      {
        pullRequest: { title: 't', author: 'a', baseRef: 'main', headRef: 'x' },
        files: [
          {
            path: 'src/a.ts',
            status: 'added',
            additions: 2,
            deletions: 0,
            patch: '@@ -0,0 +1,2 @@\n+debugger;\n+it.only("x", () => {})',
          },
        ],
      },
      DEFAULT_CONFIG,
    );

    await reviews.completeRun(run.id, { conclusion: 'failure', result });
    await reviews.completeRun(run.id, { conclusion: 'failure', result });

    const { rows: stored } = await pool.query(
      'select rule, severity, line from findings where run_id = $1 order by line',
      [run.id],
    );
    expect(stored).toEqual([
      { rule: 'debugger', severity: 'major', line: 1 },
      { rule: 'focused-test', severity: 'critical', line: 2 },
    ]);
    const { rows } = await pool.query(
      'select status, conclusion, gate_status, findings_count, counts, check_run_id from review_runs where id = $1',
      [run.id],
    );
    expect(rows[0]).toMatchObject({
      status: 'completed',
      conclusion: 'failure',
      gate_status: 'failed',
      findings_count: 2,
      counts: { info: 0, minor: 0, major: 1, critical: 1, blocker: 0 },
      check_run_id: '9007199254740',
    });
  });

  it('records failures and invalid configurations without a verdict', async () => {
    const { run } = await reviews.createRun(5001, SHA);
    await reviews.failRun(run.id, 'GitHub 502');
    expect((await reviews.findRunContext(run.id))?.run.status).toBe('failed');

    await reviews.completeRun(run.id, { conclusion: 'neutral', result: null });
    const { rows } = await pool.query(
      'select status, conclusion, gate_status, error from review_runs where id = $1',
      [run.id],
    );
    expect(rows[0]).toEqual({
      status: 'completed',
      conclusion: 'neutral',
      gate_status: null,
      error: null,
    });
  });

  it('cascades the uninstallation to every row of the account', async () => {
    const { run } = await reviews.createRun(5001, SHA);
    await reviews.completeRun(run.id, {
      conclusion: 'failure',
      result: runReview(
        {
          pullRequest: { title: 't', author: 'a', baseRef: 'main', headRef: 'x' },
          files: [
            {
              path: 'a.ts',
              status: 'added',
              additions: 1,
              deletions: 0,
              patch: '@@ -0,0 +1 @@\n+debugger;',
            },
          ],
        },
        DEFAULT_CONFIG,
      ),
    });

    await reviews.deleteInstallation(42);

    for (const table of ['repositories', 'pull_requests', 'review_runs', 'findings']) {
      const { rows } = await pool.query<{ count: string }>(`select count(*) from ${table}`);
      expect(Number(rows[0]?.count), table).toBe(0);
    }
  });

  it('keeps a known default branch, moves repositories and removes them', async () => {
    await reviews.upsertInstallation({ id: 43, accountLogin: 'other', accountType: 'User' });
    await reviews.upsertRepositories([
      { id: 1001, installationId: 43, fullName: 'other/shop', private: false },
    ]);
    const { rows } = await pool.query(
      'select installation_id, full_name, default_branch from repositories where id = 1001',
    );
    expect(rows[0]).toEqual({
      installation_id: '43',
      full_name: 'other/shop',
      default_branch: 'main',
    });

    await reviews.deleteRepositories([1001]);
    await reviews.deleteRepositories([]);
    expect((await pool.query('select 1 from repositories')).rowCount).toBe(0);
  });

  it('tracks suspension', async () => {
    await reviews.setInstallationSuspended(42, true);
    expect(
      (await pool.query('select suspended_at from installations')).rows[0]?.suspended_at,
    ).toBeInstanceOf(Date);
    await reviews.setInstallationSuspended(42, false);
    expect(
      (await pool.query('select suspended_at from installations')).rows[0]?.suspended_at,
    ).toBeNull();
  });

  it('rejects malformed commits at the database level too', async () => {
    await expect(reviews.createRun(5001, 'not-a-sha')).rejects.toThrow(
      /review_runs_head_sha_check/,
    );
  });
});
