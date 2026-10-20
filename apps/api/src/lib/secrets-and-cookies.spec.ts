import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { isSessionId, newSessionId, sessionKey } from '../modules/auth/session.js';
import { cookieName, readCookie, serializeCookie } from './cookies.js';
import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('round-trips and never produces the same ciphertext twice', () => {
    const first = box.seal('ghu_token');
    const second = box.seal('ghu_token');
    expect(first).not.toBe(second);
    expect(first).not.toContain('ghu_token');
    expect(box.open(first)).toBe('ghu_token');
  });

  it('refuses tampered, foreign and malformed values', () => {
    const sealed = box.seal('ghu_token');
    const [version, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => box.open([version, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => new SecretBox(randomBytes(32)).open(sealed)).toThrow();
    expect(() => box.open('v2.a.b.c')).toThrow('Malformed sealed value');
    expect(() => box.open('garbage')).toThrow('Malformed sealed value');
    expect(() => new SecretBox(randomBytes(16))).toThrow('32-byte key');
  });
});

describe('cookies', () => {
  const requestWith = (cookie?: string) => ({ headers: { cookie } }) as unknown as Request;

  it('reads one cookie among several', () => {
    expect(
      readCookie(
        requestWith('a=1; __Host-codelens_session=abc%2Fdef; b=2'),
        '__Host-codelens_session',
      ),
    ).toBe('abc/def');
    expect(readCookie(requestWith('a=1'), 'b')).toBeUndefined();
    expect(readCookie(requestWith(), 'a')).toBeUndefined();
    expect(readCookie(requestWith('broken; a=%E0%A4%A'), 'a')).toBeUndefined();
  });

  it('prefixes secure cookies with __Host- and serializes the attributes', () => {
    expect(cookieName('codelens_session', true)).toBe('__Host-codelens_session');
    expect(cookieName('codelens_session', false)).toBe('codelens_session');
    expect(serializeCookie('a', 'b c', { secure: false, maxAgeSeconds: 10.7 })).toBe(
      'a=b%20c; Path=/; HttpOnly; SameSite=Lax; Max-Age=10',
    );
  });
});

describe('session identifiers', () => {
  it('are random, 256-bit and stored by digest', () => {
    const id = newSessionId();
    expect(isSessionId(id)).toBe(true);
    expect(isSessionId(newSessionId())).toBe(true);
    expect(newSessionId()).not.toBe(id);
    expect(sessionKey(id)).toMatch(/^session:[0-9a-f]{64}$/);
    expect(sessionKey(id)).not.toContain(id);
    expect(isSessionId('short')).toBe(false);
    expect(isSessionId(undefined)).toBe(false);
  });
});
