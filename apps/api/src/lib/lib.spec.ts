import { describe, expect, it } from 'vitest';
import { loadApiConfig, loadWorkerConfig } from '../config.js';
import { sign, verifySignature } from './signature.js';

describe('webhook signatures', () => {
  const body = Buffer.from('{"action":"opened"}');

  it('accepts the signature of any active secret', () => {
    const signature = sign('second-secret', body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(body, signature, ['first-secret', 'second-secret'])).toBe(true);
  });

  it('rejects other secrets, other bodies and malformed headers', () => {
    expect(verifySignature(body, sign('other', body), ['first-secret'])).toBe(false);
    expect(verifySignature(Buffer.from('{}'), sign('first-secret', body), ['first-secret'])).toBe(
      false,
    );
    expect(verifySignature(body, undefined, ['first-secret'])).toBe(false);
    expect(verifySignature(body, `sha256=${'0'.repeat(63)}`, ['first-secret'])).toBe(false);
    expect(verifySignature(body, sign('first-secret', body).toUpperCase(), ['first-secret'])).toBe(
      false,
    );
  });
});

const base = {
  DATABASE_URL: 'postgresql://codelens:codelens@localhost:5432/codelens',
  MONGODB_URL: 'mongodb://localhost:27017',
  REDIS_URL: 'redis://localhost:6379',
};

const dashboard = {
  GITHUB_CLIENT_ID: 'Iv1.client',
  GITHUB_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: Buffer.alloc(32, 7).toString('base64'),
};

describe('configuration', () => {
  it('loads the API configuration with defaults and several webhook secrets', () => {
    const config = loadApiConfig({
      ...base,
      ...dashboard,
      GITHUB_WEBHOOK_SECRETS: ' a-first-secret-of-20-chars , another-secret-of-20chars ',
    });
    expect(config).toMatchObject({
      PORT: 3000,
      TRUST_PROXY_HOPS: 0,
      MONGODB_DATABASE: 'codelens',
      GITHUB_WEBHOOK_SECRETS: ['a-first-secret-of-20-chars', 'another-secret-of-20chars'],
      PUBLIC_URL: 'http://localhost:3001',
      COOKIE_SECURE: true,
      SESSION_HOURS: 8,
    });
    expect(config.SESSION_SECRET).toHaveLength(32);
  });

  it('refuses a session secret that is not 32 bytes', () => {
    expect(() =>
      loadApiConfig({
        ...base,
        ...dashboard,
        SESSION_SECRET: Buffer.alloc(16).toString('base64'),
        GITHUB_WEBHOOK_SECRETS: 'a-first-secret-of-20-chars',
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('refuses short secrets and malformed URLs, naming the variables', () => {
    expect(() => loadApiConfig({ ...base, GITHUB_WEBHOOK_SECRETS: 'short' })).toThrow(
      /GITHUB_WEBHOOK_SECRETS/,
    );
    expect(() =>
      loadApiConfig({
        ...base,
        DATABASE_URL: 'mysql://x',
        GITHUB_WEBHOOK_SECRETS: 'a-first-secret-of-20-chars',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('reads the GitHub App key inline or from a file', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----';
    const inline = loadWorkerConfig({ ...base, GITHUB_APP_ID: '123', GITHUB_PRIVATE_KEY: pem });
    expect(inline.GITHUB_PRIVATE_KEY).toBe(
      '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----',
    );
    expect(inline).toMatchObject({
      GITHUB_APP_ID: 123,
      GITHUB_API_URL: 'https://api.github.com',
      WORKER_CONCURRENCY: 4,
    });

    const fromFile = loadWorkerConfig(
      { ...base, GITHUB_APP_ID: '123', GITHUB_PRIVATE_KEY_FILE: '/run/secrets/github-app.pem' },
      (path) =>
        path === '/run/secrets/github-app.pem' ? '-----BEGIN RSA PRIVATE KEY-----\n...' : '',
    );
    expect(fromFile.GITHUB_PRIVATE_KEY).toContain('RSA PRIVATE KEY');
  });

  it('refuses a worker without a usable key or with a plain HTTP API', () => {
    expect(() => loadWorkerConfig({ ...base, GITHUB_APP_ID: '123' })).toThrow(/GITHUB_PRIVATE_KEY/);
    expect(() =>
      loadWorkerConfig({ ...base, GITHUB_APP_ID: '123', GITHUB_PRIVATE_KEY: 'not a key' }),
    ).toThrow(/GITHUB_PRIVATE_KEY/);
    expect(() =>
      loadWorkerConfig({
        ...base,
        GITHUB_APP_ID: '123',
        GITHUB_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
        GITHUB_API_URL: 'http://github.internal',
      }),
    ).toThrow(/GITHUB_API_URL/);
  });
});
