import type { PendingSignIn, PendingSignInStore } from '../modules/auth/auth-stores.js';
import type { GitHubOAuth, TokenGrant } from '../modules/auth/github-oauth.js';
import { OAuthError } from '../modules/auth/github-oauth.js';
import {
  newSessionId,
  type Session,
  type SessionStore,
  type SessionUser,
} from '../modules/auth/session.js';

export class MemorySessionStore implements SessionStore {
  readonly sessions = new Map<string, Session>();

  create(session: Session): Promise<string> {
    const id = newSessionId();
    this.sessions.set(id, structuredClone(session));
    return Promise.resolve(id);
  }

  get(id: string): Promise<Session | null> {
    const session = this.sessions.get(id);
    return Promise.resolve(session ? structuredClone(session) : null);
  }

  update(id: string, session: Session): Promise<void> {
    if (this.sessions.has(id)) this.sessions.set(id, structuredClone(session));
    return Promise.resolve();
  }

  destroy(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }
}

export class MemoryPendingSignInStore implements PendingSignInStore {
  readonly pending = new Map<string, PendingSignIn>();

  put(state: string, pending: PendingSignIn): Promise<void> {
    this.pending.set(state, pending);
    return Promise.resolve();
  }

  take(state: string): Promise<PendingSignIn | null> {
    const pending = this.pending.get(state) ?? null;
    this.pending.delete(state);
    return Promise.resolve(pending);
  }
}

/** GitHub OAuth in memory: one valid code, and repositories per token that tests can change. */
export class FakeGitHubOAuth implements GitHubOAuth {
  static readonly CODE = 'valid-code';
  readonly exchanges: { code: string; codeVerifier: string }[] = [];
  readonly repositoriesByToken = new Map<string, number[] | null>([['ghu_amina', [1001]]]);
  profile: SessionUser = {
    id: 7,
    login: 'amina',
    avatarUrl: 'https://avatars.githubusercontent.com/u/7',
  };
  expiresIn: number | null = 28_800;
  refreshFailure: Error | null = null;

  authorizeUrl(state: string, codeChallenge: string): string {
    return `https://github.com/login/oauth/authorize?state=${state}&code_challenge=${codeChallenge}`;
  }

  exchange(code: string, codeVerifier: string): Promise<TokenGrant> {
    this.exchanges.push({ code, codeVerifier });
    if (code !== FakeGitHubOAuth.CODE)
      return Promise.reject(new OAuthError('bad_verification_code'));
    return Promise.resolve({ accessToken: 'ghu_amina', expiresIn: this.expiresIn });
  }

  user(): Promise<SessionUser> {
    return Promise.resolve(this.profile);
  }

  accessibleRepositories(accessToken: string): Promise<number[] | null> {
    if (this.refreshFailure) return Promise.reject(this.refreshFailure);
    return Promise.resolve(this.repositoriesByToken.get(accessToken) ?? null);
  }
}
