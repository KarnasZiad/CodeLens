import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { SecretBox } from '../../lib/secret-box.js';
import type { PendingSignIn, PendingSignInStore } from './auth-stores.js';
import { newSessionId, type Session, sessionKey, type SessionStore } from './session.js';

const pendingSchema = z.object({ codeVerifier: z.string(), redirect: z.string() });
const sessionSchema = z.object({
  user: z.object({ id: z.number(), login: z.string(), avatarUrl: z.string() }),
  accessToken: z.string(),
  repositoryIds: z.array(z.number()),
  refreshedAt: z.number(),
  expiresAt: z.number(),
});

export class RedisPendingSignInStore implements PendingSignInStore {
  constructor(private readonly redis: Redis) {}

  async put(state: string, pending: PendingSignIn, ttlSeconds: number): Promise<void> {
    await this.redis.set(`oauth:state:${state}`, JSON.stringify(pending), 'EX', ttlSeconds);
  }

  async take(state: string): Promise<PendingSignIn | null> {
    const raw = await this.redis.getdel(`oauth:state:${state}`);
    return raw === null ? null : pendingSchema.parse(JSON.parse(raw));
  }
}

/** Sessions in Redis, keyed by digest, with the GitHub token sealed by a SecretBox. */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly box: SecretBox,
    private readonly now: () => number = Date.now,
  ) {}

  private serialize(session: Session): string {
    return JSON.stringify({ ...session, accessToken: this.box.seal(session.accessToken) });
  }

  async create(session: Session): Promise<string> {
    const id = newSessionId();
    const ttl = Math.max(1, session.expiresAt - this.now());
    await this.redis.set(sessionKey(id), this.serialize(session), 'PX', ttl);
    return id;
  }

  async get(id: string): Promise<Session | null> {
    const raw = await this.redis.get(sessionKey(id));
    if (raw === null) return null;
    const stored = sessionSchema.parse(JSON.parse(raw));
    return { ...stored, accessToken: this.box.open(stored.accessToken) };
  }

  async update(id: string, session: Session): Promise<void> {
    // XX: never resurrects a session destroyed meanwhile; KEEPTTL: never extends its lifetime.
    await this.redis.set(sessionKey(id), this.serialize(session), 'KEEPTTL', 'XX');
  }

  async destroy(id: string): Promise<void> {
    await this.redis.del(sessionKey(id));
  }
}
