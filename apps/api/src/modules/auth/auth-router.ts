import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler, type Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { cookieName, readCookie, serializeCookie } from '../../lib/cookies.js';
import { HttpProblem } from '../../lib/problem.js';
import type { PendingSignInStore } from './auth-stores.js';
import { type GitHubOAuth, OAuthError } from './github-oauth.js';
import { isSessionId, type Session, type SessionStore } from './session.js';

/** The repositories a user can see are checked again on GitHub at most this long after. */
export const REFRESH_AFTER_MS = 10 * 60_000;
const SIGN_IN_TTL_SECONDS = 600;

export interface AuthConfig {
  PUBLIC_URL: string;
  COOKIE_SECURE: boolean;
  SESSION_HOURS: number;
}

export interface AuthDeps {
  oauth: GitHubOAuth;
  sessions: SessionStore;
  pending: PendingSignInStore;
  config: AuthConfig;
  logger: Logger;
  now?: () => number;
}

export type AuthenticatedSession = Session & { id: string };

/** Only paths of the dashboard: never an open redirect after sign-in. */
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    value.length <= 512
    ? value
    : '/';
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const callbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(128).optional(),
  error: z.string().max(128).optional(),
});

export function sessionOf(response: Response): AuthenticatedSession {
  const session = (response.locals as { session?: AuthenticatedSession }).session;
  if (!session) throw new HttpProblem(401);
  return session;
}

function names(secure: boolean) {
  return {
    session: cookieName('codelens_session', secure),
    state: cookieName('codelens_oauth', secure),
  };
}

/** Loads the session and re-checks the visible repositories on GitHub when the list gets old. */
export function requireSession(deps: AuthDeps): RequestHandler {
  const now = deps.now ?? Date.now;
  const cookies = names(deps.config.COOKIE_SECURE);
  return async (request, response, next) => {
    const id = readCookie(request, cookies.session);
    const session = isSessionId(id) ? await deps.sessions.get(id) : null;
    if (!id || !session || session.expiresAt <= now()) throw new HttpProblem(401);

    if (now() - session.refreshedAt > REFRESH_AFTER_MS) {
      try {
        const repositoryIds = await deps.oauth.accessibleRepositories(session.accessToken);
        if (repositoryIds === null) {
          await deps.sessions.destroy(id);
          throw new HttpProblem(401);
        }
        session.repositoryIds = repositoryIds;
        session.refreshedAt = now();
        await deps.sessions.update(id, session);
      } catch (error) {
        if (error instanceof HttpProblem) throw error;
        // GitHub unavailable: the previous list stays valid until the next request.
        deps.logger.warn({ err: error }, 'could not refresh the repositories of a session');
      }
    }
    response.locals.session = { ...session, id };
    next();
  };
}

export function authRouter(deps: AuthDeps): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const { COOKIE_SECURE: secure, PUBLIC_URL, SESSION_HOURS } = deps.config;
  const cookies = names(secure);
  const publicOrigin = new URL(PUBLIC_URL).origin;

  router.get('/github/login', async (request, response) => {
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    await deps.pending.put(
      state,
      { codeVerifier, redirect: safeRedirect(request.query.redirect) },
      SIGN_IN_TTL_SECONDS,
    );
    response.setHeader(
      'set-cookie',
      serializeCookie(cookies.state, state, { secure, maxAgeSeconds: SIGN_IN_TTL_SECONDS }),
    );
    response.redirect(302, deps.oauth.authorizeUrl(state, challenge));
  });

  router.get('/github/callback', async (request, response) => {
    const clearState = serializeCookie(cookies.state, '', { secure, maxAgeSeconds: 0 });
    const fail = (reason: string) => {
      response.setHeader('set-cookie', clearState);
      response.redirect(303, `/?error=${reason}`);
    };

    const query = callbackQuery.safeParse(request.query);
    if (!query.success || query.data.error !== undefined) {
      fail('access_denied');
      return;
    }
    const { code, state } = query.data;
    // The state must come back to the browser that started the sign-in (login CSRF).
    const expected = readCookie(request, cookies.state);
    if (!code || !state || !expected || !sameSecret(state, expected)) {
      fail('state');
      return;
    }
    const pending = await deps.pending.take(state);
    if (!pending) {
      fail('expired');
      return;
    }

    try {
      const grant = await deps.oauth.exchange(code, pending.codeVerifier);
      const [user, repositoryIds] = await Promise.all([
        deps.oauth.user(grant.accessToken),
        deps.oauth.accessibleRepositories(grant.accessToken),
      ]);
      if (repositoryIds === null) throw new OAuthError('Token rejected right after the exchange');
      const lifetime = Math.min(SESSION_HOURS * 3600_000, (grant.expiresIn ?? Infinity) * 1000);
      const session: Session = {
        user,
        accessToken: grant.accessToken,
        repositoryIds,
        refreshedAt: now(),
        expiresAt: now() + lifetime,
      };
      const id = await deps.sessions.create(session);
      response.setHeader('set-cookie', [
        clearState,
        serializeCookie(cookies.session, id, { secure, maxAgeSeconds: lifetime / 1000 }),
      ]);
      deps.logger.info({ user: user.login, repositories: repositoryIds.length }, 'signed in');
      response.redirect(303, pending.redirect);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      deps.logger.warn({ err: error }, 'sign-in refused');
      fail('oauth');
    }
  });

  router.post('/logout', async (request, response) => {
    // A cross-site form cannot sign the user out: SameSite=Lax sends the cookie on top-level POSTs.
    if (request.headers.origin !== publicOrigin) throw new HttpProblem(403, 'Cross-origin request');
    const id = readCookie(request, cookies.session);
    if (isSessionId(id)) await deps.sessions.destroy(id);
    response.setHeader(
      'set-cookie',
      serializeCookie(cookies.session, '', { secure, maxAgeSeconds: 0 }),
    );
    response.status(204).end();
  });

  router.get('/me', requireSession(deps), (_request, response) => {
    const { user, repositoryIds } = sessionOf(response);
    response.json({ user, repositories: repositoryIds.length });
  });

  return router;
}
