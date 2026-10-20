import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeGitHubOAuth } from '../../testing/auth-doubles.js';
import { createTestApp, PUBLIC_URL, SESSION_COOKIE, STATE_COOKIE } from '../../testing/fixtures.js';
import { REFRESH_AFTER_MS, safeRedirect } from './auth-router.js';

type TestApp = ReturnType<typeof createTestApp>;

function setCookies(response: request.Response): string[] {
  const header = response.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

async function startSignIn(app: TestApp['app'], redirect = '/repositories/acme/shop') {
  const response = await request(app).get(
    `/api/auth/github/login?redirect=${encodeURIComponent(redirect)}`,
  );
  const location = new URL(String(response.headers.location));
  return {
    response,
    state: location.searchParams.get('state') ?? '',
    challenge: location.searchParams.get('code_challenge') ?? '',
  };
}

describe('sign-in with GitHub', () => {
  it('redirects to GitHub with a state bound to the browser and a PKCE challenge', async () => {
    const { app, pending } = createTestApp();
    const { response, state, challenge } = await startSignIn(app);

    expect(response.status).toBe(302);
    expect(state).toMatch(/^[\w-]{43}$/);
    const cookie = setCookies(response)[0] ?? '';
    expect(cookie).toContain(`${STATE_COOKIE}=${state}`);
    expect(cookie).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);

    const verifier = pending.pending.get(state)?.codeVerifier ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
  });

  it('opens a session and goes back to the requested page', async () => {
    const { app, oauth, sessions, clock } = createTestApp();
    const { state } = await startSignIn(app);

    const response = await request(app)
      .get(`/api/auth/github/callback?code=${FakeGitHubOAuth.CODE}&state=${state}`)
      .set('cookie', `${STATE_COOKIE}=${state}`);

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/repositories/acme/shop');
    const cookies = setCookies(response);
    expect(cookies[0]).toMatch(new RegExp(`^${STATE_COOKIE}=; .*Max-Age=0`));
    expect(cookies[1]).toMatch(
      new RegExp(
        `^${SESSION_COOKIE}=[\\w-]{43}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure$`,
      ),
    );
    expect(oauth.exchanges[0]?.codeVerifier).toMatch(/^[\w-]{43}$/);

    const [session] = sessions.sessions.values();
    expect(session).toMatchObject({
      user: { login: 'amina' },
      repositoryIds: [1001],
      expiresAt: clock.now + 8 * 3600_000,
    });
  });

  it('keeps the session within the lifetime of the GitHub token', async () => {
    const { app, oauth, sessions, clock } = createTestApp();
    oauth.expiresIn = 3600;
    const { state } = await startSignIn(app);
    await request(app)
      .get(`/api/auth/github/callback?code=${FakeGitHubOAuth.CODE}&state=${state}`)
      .set('cookie', `${STATE_COOKIE}=${state}`);
    expect([...sessions.sessions.values()][0]?.expiresAt).toBe(clock.now + 3600_000);
  });

  it.each([
    [
      'no state cookie (login CSRF)',
      (state: string) => ({ query: `code=${FakeGitHubOAuth.CODE}&state=${state}`, cookie: '' }),
      'state',
    ],
    [
      'another state',
      (state: string) => ({
        query: `code=${FakeGitHubOAuth.CODE}&state=${state}`,
        cookie: `${STATE_COOKIE}=${'x'.repeat(43)}`,
      }),
      'state',
    ],
    [
      'a refused authorization',
      () => ({ query: 'error=access_denied', cookie: '' }),
      'access_denied',
    ],
    [
      'an invalid code',
      (state: string) => ({
        query: `code=forged&state=${state}`,
        cookie: `${STATE_COOKIE}=${state}`,
      }),
      'oauth',
    ],
  ])('refuses %s', async (_case, build, reason) => {
    const { app, sessions } = createTestApp();
    const { state } = await startSignIn(app);
    const { query, cookie } = build(state);

    const response = await request(app)
      .get(`/api/auth/github/callback?${query}`)
      .set('cookie', cookie);

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe(`/?error=${reason}`);
    expect(sessions.sessions.size).toBe(0);
  });

  it('uses a state only once', async () => {
    const { app } = createTestApp();
    const { state } = await startSignIn(app);
    const callback = () =>
      request(app)
        .get(`/api/auth/github/callback?code=${FakeGitHubOAuth.CODE}&state=${state}`)
        .set('cookie', `${STATE_COOKIE}=${state}`);
    expect((await callback()).headers.location).toBe('/repositories/acme/shop');
    expect((await callback()).headers.location).toBe('/?error=expired');
  });

  it('refuses a token that GitHub rejects right away', async () => {
    const { app, oauth } = createTestApp();
    oauth.repositoriesByToken.set('ghu_amina', null);
    const { state } = await startSignIn(app);
    const response = await request(app)
      .get(`/api/auth/github/callback?code=${FakeGitHubOAuth.CODE}&state=${state}`)
      .set('cookie', `${STATE_COOKIE}=${state}`);
    expect(response.headers.location).toBe('/?error=oauth');
  });

  it('never redirects outside the dashboard', async () => {
    expect(safeRedirect('/runs/1')).toBe('/runs/1');
    for (const value of [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      undefined,
      ['/a'],
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safeRedirect(value)).toBe('/');
    }
    const { app, pending } = createTestApp();
    const { state } = await startSignIn(app, '//evil.example');
    expect(pending.pending.get(state)?.redirect).toBe('/');
  });
});

describe('sessions', () => {
  it('describes the signed-in user', async () => {
    const { app, signedIn } = createTestApp();
    const response = await request(app)
      .get('/api/auth/me')
      .set('cookie', await signedIn());
    expect(response.body).toEqual({
      user: { id: 7, login: 'amina', avatarUrl: 'https://avatars.githubusercontent.com/u/7' },
      repositories: 1,
    });
  });

  it.each([
    ['no cookie', ''],
    ['a malformed cookie', `${SESSION_COOKIE}=../../etc`],
    ['an unknown session', `${SESSION_COOKIE}=${'a'.repeat(43)}`],
  ])('answers 401 with %s', async (_case, cookie) => {
    const { app } = createTestApp();
    const response = await request(app).get('/api/repositories').set('cookie', cookie);
    expect(response.status).toBe(401);
    expect(response.type).toBe('application/problem+json');
  });

  it('answers 401 once the session has expired', async () => {
    const { app, signedIn, clock } = createTestApp();
    const cookie = await signedIn({ expiresAt: clock.now + 1000 });
    clock.now += 2000;
    expect((await request(app).get('/api/auth/me').set('cookie', cookie)).status).toBe(401);
  });

  it('re-checks the visible repositories on GitHub every ten minutes', async () => {
    const { app, signedIn, oauth, clock, sessions } = createTestApp();
    const cookie = await signedIn();
    oauth.repositoriesByToken.set('ghu_amina', [1001, 1002]);

    clock.now += REFRESH_AFTER_MS - 1000;
    expect(
      (await request(app).get('/api/repositories').set('cookie', cookie)).body.items,
    ).toHaveLength(1);

    clock.now += 2000;
    expect(
      (await request(app).get('/api/repositories').set('cookie', cookie)).body.items,
    ).toHaveLength(2);
    expect([...sessions.sessions.values()][0]?.refreshedAt).toBe(clock.now);
  });

  it('ends the session when GitHub revoked the token', async () => {
    const { app, signedIn, oauth, clock, sessions } = createTestApp();
    const cookie = await signedIn();
    oauth.repositoriesByToken.set('ghu_amina', null);
    clock.now += REFRESH_AFTER_MS + 1;
    expect((await request(app).get('/api/repositories').set('cookie', cookie)).status).toBe(401);
    expect(sessions.sessions.size).toBe(0);
  });

  it('keeps the previous list while GitHub is unavailable', async () => {
    const { app, signedIn, oauth, clock } = createTestApp();
    const cookie = await signedIn();
    oauth.refreshFailure = new Error('GitHub 503');
    clock.now += REFRESH_AFTER_MS + 1;
    expect(
      (await request(app).get('/api/repositories').set('cookie', cookie)).body.items,
    ).toHaveLength(1);
  });

  it('signs out from the dashboard only, never from another site', async () => {
    const { app, signedIn, sessions } = createTestApp();
    const cookie = await signedIn();

    const forged = await request(app)
      .post('/api/auth/logout')
      .set('cookie', cookie)
      .set('origin', 'https://evil.example');
    expect(forged.status).toBe(403);
    expect(sessions.sessions.size).toBe(1);

    const response = await request(app)
      .post('/api/auth/logout')
      .set('cookie', cookie)
      .set('origin', PUBLIC_URL);
    expect(response.status).toBe(204);
    expect(setCookies(response)[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=; .*Max-Age=0`));
    expect(sessions.sessions.size).toBe(0);
  });

  it('limits the rate of sign-in requests', async () => {
    const { app } = createTestApp();
    const responses = [];
    for (let index = 0; index < 31; index += 1) {
      responses.push(await request(app).get('/api/auth/github/login'));
    }
    expect(responses.at(-1)?.status).toBe(429);
    expect(responses.at(-1)?.body).toMatchObject({ title: 'Too Many Requests' });
  });
});
