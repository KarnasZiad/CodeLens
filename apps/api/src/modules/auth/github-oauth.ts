import { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { z } from 'zod';
import type { SessionUser } from './session.js';

/** Upper bound of repositories kept in a session: beyond, the dashboard lists the first ones. */
export const MAX_REPOSITORIES = 1000;

export interface TokenGrant {
  accessToken: string;
  /** Seconds; GitHub App user tokens expire after 8 hours when expiration is enabled. */
  expiresIn: number | null;
}

/** GitHub as seen by the dashboard sign-in: OAuth web flow with PKCE, then user-scoped reads. */
export interface GitHubOAuth {
  authorizeUrl(state: string, codeChallenge: string): string;
  exchange(code: string, codeVerifier: string): Promise<TokenGrant>;
  user(accessToken: string): Promise<SessionUser>;
  /** Repositories of the app's installations that this user can access; null if the token died. */
  accessibleRepositories(accessToken: string): Promise<number[] | null>;
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

const tokenResponse = z.union([
  z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive().optional() }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);

export interface GitHubOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiUrl: string;
  webUrl: string;
  fetch?: typeof fetch;
}

export class GitHubOAuthClient implements GitHubOAuth {
  constructor(private readonly options: GitHubOAuthOptions) {}

  private octokit(accessToken: string): Octokit {
    return new Octokit({
      auth: accessToken,
      baseUrl: this.options.apiUrl,
      userAgent: 'codelens-dashboard',
      request: this.options.fetch ? { fetch: this.options.fetch } : {},
    });
  }

  authorizeUrl(state: string, codeChallenge: string): string {
    const url = new URL('/login/oauth/authorize', this.options.webUrl);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      allow_signup: 'false',
    }).toString();
    return url.toString();
  }

  async exchange(code: string, codeVerifier: string): Promise<TokenGrant> {
    const response = await (this.options.fetch ?? fetch)(
      new URL('/login/oauth/access_token', this.options.webUrl),
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          code,
          redirect_uri: this.options.redirectUri,
          code_verifier: codeVerifier,
        }),
      },
    );
    if (!response.ok) throw new OAuthError(`Token endpoint answered ${response.status}`);
    // GitHub reports a refused code with a 200 and an "error" field.
    const parsed = tokenResponse.safeParse(await response.json());
    if (!parsed.success) throw new OAuthError('Unexpected token response');
    if ('error' in parsed.data)
      throw new OAuthError(`GitHub refused the code: ${parsed.data.error}`);
    return { accessToken: parsed.data.access_token, expiresIn: parsed.data.expires_in ?? null };
  }

  async user(accessToken: string): Promise<SessionUser> {
    const { data } = await this.octokit(accessToken).rest.users.getAuthenticated();
    return { id: data.id, login: data.login, avatarUrl: data.avatar_url };
  }

  async accessibleRepositories(accessToken: string): Promise<number[] | null> {
    const octokit = this.octokit(accessToken);
    try {
      const installations = await octokit.paginate(
        octokit.rest.apps.listInstallationsForAuthenticatedUser,
        { per_page: 100 },
      );
      const ids: number[] = [];
      for (const installation of installations) {
        if (ids.length >= MAX_REPOSITORIES) break;
        const repositories = await octokit.paginate(
          octokit.rest.apps.listInstallationReposForAuthenticatedUser,
          { installation_id: installation.id, per_page: 100 },
        );
        ids.push(...repositories.map((repository) => repository.id));
      }
      return ids.slice(0, MAX_REPOSITORIES);
    } catch (error) {
      // Revoked or expired token: the session ends.
      if (error instanceof RequestError && error.status === 401) return null;
      throw error;
    }
  }
}
