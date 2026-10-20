import { createHash, randomBytes } from 'node:crypto';

export interface SessionUser {
  id: number;
  login: string;
  avatarUrl: string;
}

export interface Session {
  user: SessionUser;
  /** GitHub user token, encrypted at rest; used only to re-check which repositories are visible. */
  accessToken: string;
  /** Repositories the user can see on GitHub: the only ones the dashboard shows. */
  repositoryIds: number[];
  refreshedAt: number;
  expiresAt: number;
}

/** Server-side sessions; the cookie only carries a random identifier. */
export interface SessionStore {
  create(session: Session): Promise<string>;
  get(id: string): Promise<Session | null>;
  update(id: string, session: Session): Promise<void>;
  destroy(id: string): Promise<void>;
}

/** 256 random bits, URL-safe. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** The store keys sessions by digest: a leaked store dump cannot be replayed as cookies. */
export function sessionKey(id: string): string {
  return `session:${createHash('sha256').update(id).digest('hex')}`;
}

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

export function isSessionId(value: string | undefined): value is string {
  return value !== undefined && SESSION_ID.test(value);
}
