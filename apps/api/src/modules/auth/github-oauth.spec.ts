import { describe, expect, it } from 'vitest';
import { GitHubOAuthClient, MAX_REPOSITORIES, OAuthError } from './github-oauth.js';

interface Recorded {
  method: string;
  url: URL;
  body: unknown;
  authorization: string | null;
}

function client(handler: (call: Recorded) => Response) {
  const calls: Recorded[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const call: Recorded = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: new Headers(init?.headers).get('authorization'),
    };
    calls.push(call);
    const response = handler(call);
    // A network response knows its URL; Octokit's pagination reads it.
    Object.defineProperty(response, 'url', { value: url.href });
    return Promise.resolve(response);
  };
  return {
    calls,
    oauth: new GitHubOAuthClient({
      clientId: 'Iv1.client',
      clientSecret: 'client-secret',
      redirectUri: 'https://codelens.test/api/auth/github/callback',
      apiUrl: 'https://api.github.com',
      webUrl: 'https://github.com',
      fetch,
    }),
  };
}

describe('GitHubOAuthClient', () => {
  it('builds the authorization URL with the state and the S256 challenge', () => {
    const { oauth } = client(() => Response.json({}));
    const url = new URL(oauth.authorizeUrl('the-state', 'the-challenge'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv1.client',
      redirect_uri: 'https://codelens.test/api/auth/github/callback',
      state: 'the-state',
      code_challenge: 'the-challenge',
      code_challenge_method: 'S256',
      allow_signup: 'false',
    });
  });

  it('exchanges the code with the verifier', async () => {
    const { oauth, calls } = client(() =>
      Response.json({ access_token: 'ghu_x', expires_in: 28800 }),
    );
    expect(await oauth.exchange('code', 'verifier')).toEqual({
      accessToken: 'ghu_x',
      expiresIn: 28800,
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: {
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'code',
        code_verifier: 'verifier',
      },
    });

    const withoutExpiry = client(() => Response.json({ access_token: 'ghu_x' }));
    expect((await withoutExpiry.oauth.exchange('code', 'verifier')).expiresIn).toBeNull();
  });

  it('turns every refusal into an OAuthError', async () => {
    const refused = client(() => Response.json({ error: 'bad_verification_code' }));
    await expect(refused.oauth.exchange('code', 'verifier')).rejects.toThrow(OAuthError);
    const broken = client(() => Response.json({ unexpected: true }));
    await expect(broken.oauth.exchange('code', 'verifier')).rejects.toThrow(
      'Unexpected token response',
    );
    const down = client(() => new Response('oops', { status: 502 }));
    await expect(down.oauth.exchange('code', 'verifier')).rejects.toThrow(
      'Token endpoint answered 502',
    );
  });

  it('reads the user and the repositories of every installation it can access', async () => {
    const { oauth, calls } = client((call) => {
      if (call.url.pathname === '/user')
        return Response.json({ id: 7, login: 'amina', avatar_url: 'https://a/7' });
      if (call.url.pathname === '/user/installations') {
        return Response.json({ total_count: 2, installations: [{ id: 42 }, { id: 43 }] });
      }
      const installation = /\/user\/installations\/(\d+)\/repositories/.exec(
        call.url.pathname,
      )?.[1];
      return Response.json({
        total_count: 1,
        repositories: [{ id: installation === '42' ? 1001 : 2001 }],
      });
    });

    expect(await oauth.user('ghu_x')).toEqual({ id: 7, login: 'amina', avatarUrl: 'https://a/7' });
    expect(await oauth.accessibleRepositories('ghu_x')).toEqual([1001, 2001]);
    expect(calls.every((call) => call.authorization === 'token ghu_x')).toBe(true);
  });

  it('returns null for a revoked token and caps the list', async () => {
    const revoked = client(() => Response.json({ message: 'Bad credentials' }, { status: 401 }));
    expect(await revoked.oauth.accessibleRepositories('ghu_x')).toBeNull();

    const failing = client(() => Response.json({ message: 'Server Error' }, { status: 500 }));
    await expect(failing.oauth.accessibleRepositories('ghu_x')).rejects.toMatchObject({
      status: 500,
    });

    const many = client((call) =>
      call.url.pathname === '/user/installations'
        ? Response.json({ total_count: 2, installations: [{ id: 1 }, { id: 2 }] })
        : Response.json({
            total_count: 1000,
            repositories: Array.from({ length: MAX_REPOSITORIES }, (_, index) => ({
              id: index + 1,
            })),
          }),
    );
    expect(await many.oauth.accessibleRepositories('ghu_x')).toHaveLength(MAX_REPOSITORIES);
  });
});
