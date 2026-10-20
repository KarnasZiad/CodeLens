import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/fixtures.js';
import type { RunDetail } from './dashboard-repository.js';

const RUN_ID = '0f6d3c1e-8a4b-4c39-9d2e-6b7a5f4e3d21';
const OTHER_RUN_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function run(repositoryId: number, fullName: string, id: string): RunDetail {
  return {
    id,
    headSha: 'a'.repeat(40),
    status: 'completed',
    gateStatus: 'failed',
    conclusion: 'failure',
    counts: { blocker: 1 },
    findingsCount: 1,
    partial: false,
    durationMs: 820,
    queuedAt: '2026-10-20T10:00:00.000Z',
    completedAt: '2026-10-20T10:00:01.000Z',
    repository: { id: repositoryId, fullName },
    pullRequest: { number: 7, title: 'Add the cart', author: 'amina' },
    findings: [
      {
        analyzer: 'secrets',
        rule: 'github-token',
        severity: 'blocker',
        path: 'src/a.ts',
        line: 3,
        endLine: null,
        message: 'Jeton GitHub détecté.',
      },
    ],
  };
}

function setup() {
  const context = createTestApp();
  context.dashboard.pullRequests.set(1001, [
    {
      number: 7,
      title: 'Add the cart',
      author: 'amina',
      state: 'open',
      draft: false,
      updatedAt: '2026-10-20T10:00:00.000Z',
      latestRun: null,
    },
    {
      number: 6,
      title: 'Old work',
      author: 'youssef',
      state: 'merged',
      draft: false,
      updatedAt: '2026-10-19T10:00:00.000Z',
      latestRun: null,
    },
  ]);
  context.dashboard.runs.set(RUN_ID, run(1001, 'acme/shop', RUN_ID));
  context.dashboard.runs.set(OTHER_RUN_ID, run(1002, 'acme/secret-project', OTHER_RUN_ID));
  return context;
}

describe('dashboard API', () => {
  it('lists only the repositories visible to the user', async () => {
    const { app, signedIn } = setup();
    const response = await request(app)
      .get('/api/repositories')
      .set('cookie', await signedIn());
    const items = response.body.items as { fullName: string }[];
    expect(items.map((item) => item.fullName)).toEqual(['acme/shop']);
  });

  it('lists the open pull requests of a repository, or all of them', async () => {
    const { app, signedIn } = setup();
    const cookie = await signedIn();
    const open = await request(app).get('/api/repositories/acme/shop/pulls').set('cookie', cookie);
    expect(open.body).toMatchObject({ repository: { id: 1001, fullName: 'acme/shop' } });
    expect((open.body.items as { number: number }[]).map((pull) => pull.number)).toEqual([7]);

    const all = await request(app)
      .get('/api/repositories/acme/shop/pulls?state=all')
      .set('cookie', cookie);
    expect(all.body.items).toHaveLength(2);
  });

  it('shows a review with its findings', async () => {
    const { app, signedIn } = setup();
    const response = await request(app)
      .get(`/api/runs/${RUN_ID}`)
      .set('cookie', await signedIn());
    expect(response.body).toMatchObject({
      id: RUN_ID,
      gateStatus: 'failed',
      findings: [{ rule: 'github-token' }],
    });
  });

  it('returns the trends over the requested period', async () => {
    const { app, signedIn } = setup();
    const response = await request(app)
      .get('/api/repositories/acme/shop/trends?days=14')
      .set('cookie', await signedIn());
    expect(response.body).toMatchObject({ days: 14, gate: { passed: 3, failed: 1 } });
  });

  it('answers 404, not 403, for repositories and reviews the user cannot see', async () => {
    const { app, signedIn } = setup();
    const cookie = await signedIn();
    for (const path of [
      '/api/repositories/acme/secret-project/pulls',
      '/api/repositories/acme/secret-project/trends',
      '/api/repositories/acme/unknown/pulls',
      `/api/runs/${OTHER_RUN_ID}`,
      '/api/runs/00000000-0000-4000-8000-000000000000',
      '/api/runs/not-a-uuid',
    ]) {
      const response = await request(app).get(path).set('cookie', cookie);
      expect(response.status, path).toBe(404);
    }
  });

  it('validates the parameters', async () => {
    const { app, signedIn } = setup();
    const cookie = await signedIn();
    expect(
      (
        await request(app)
          .get('/api/repositories/acme/shop/pulls?state=closed')
          .set('cookie', cookie)
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get('/api/repositories/acme/shop/trends?days=365').set('cookie', cookie))
        .status,
    ).toBe(400);
    expect(
      (await request(app).get('/api/repositories/acme/shop/pulls?extra=1').set('cookie', cookie))
        .status,
    ).toBe(400);
    expect(
      (await request(app).get('/api/repositories/ac%20me/shop/pulls').set('cookie', cookie)).status,
    ).toBe(400);
  });

  it('requires a session for every data route', async () => {
    const { app } = setup();
    for (const path of [
      '/api/repositories',
      '/api/repositories/acme/shop/pulls',
      `/api/runs/${RUN_ID}`,
    ]) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });
});
