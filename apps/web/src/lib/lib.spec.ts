import { describe, expect, it, vi } from 'vitest';
import { requestApi } from './api-client';
import { contentSecurityPolicy } from './csp';
import {
  blobUrl,
  describeCounts,
  formatDateTime,
  formatDuration,
  groupByFile,
  passRate,
  shortSha,
} from './format';
import type { Finding } from './types';

describe('format', () => {
  it('formats dates in French, in the Moroccan time zone', () => {
    expect(formatDateTime('2026-10-20T09:30:00Z')).toMatch(/20 oct\. 2026.*10:30/);
    expect(formatDateTime(null)).toBe('—');
  });

  it('formats durations, commits and counts', () => {
    expect(formatDuration(820)).toBe('820 ms');
    expect(formatDuration(1260)).toBe('1,3 s');
    expect(formatDuration(null)).toBe('—');
    expect(shortSha('0123456789abcdef')).toBe('0123456');
    expect(describeCounts({ major: 1, blocker: 2, info: 3 })).toBe('2 bloquants, 1 majeur, 3 info');
    expect(describeCounts({ minor: 0 })).toBe('aucun constat');
  });

  it('groups findings by file and keeps their order', () => {
    const finding = (path: string | null, rule: string): Finding => ({
      analyzer: 'a',
      rule,
      severity: 'major',
      path,
      line: path ? 1 : null,
      endLine: null,
      message: 'm',
    });
    const groups = groupByFile([
      finding('b.ts', '1'),
      finding(null, '2'),
      finding('b.ts', '3'),
      finding('a.ts', '4'),
    ]);
    expect(groups.map((group) => [group.path, group.findings.map((item) => item.rule)])).toEqual([
      ['b.ts', ['1', '3']],
      [null, ['2']],
      ['a.ts', ['4']],
    ]);
  });

  it('computes the gate pass rate', () => {
    expect(passRate({ passed: 3, failed: 1 })).toBe(75);
    expect(passRate({ passed: 0, failed: 0 })).toBeNull();
  });

  it('links to the reviewed commit with encoded paths', () => {
    expect(blobUrl('https://github.com', 'acme/shop', 'abc', 'src/a b#.ts', 3)).toBe(
      'https://github.com/acme/shop/blob/abc/src/a%20b%23.ts#L3',
    );
    expect(blobUrl('https://github.com', 'acme/shop', 'abc', 'README.md', null)).toBe(
      'https://github.com/acme/shop/blob/abc/README.md',
    );
  });
});

describe('requestApi', () => {
  const fetcher = (response: Response | Error) =>
    vi.fn<typeof fetch>(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
    );

  it('forwards the session cookie and parses the body', async () => {
    const fetch = fetcher(Response.json({ items: [] }));
    const result = await requestApi({
      baseUrl: 'http://api:3000',
      path: '/api/repositories',
      cookie: 'a=b',
      fetcher: fetch,
    });
    expect(result).toEqual({ ok: true, data: { items: [] } });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toEqual(new URL('http://api:3000/api/repositories'));
    expect(init?.headers).toEqual({ accept: 'application/json', cookie: 'a=b' });
    expect(init?.cache).toBe('no-store');
  });

  it('sends no cookie header for a visitor', async () => {
    const fetch = fetcher(Response.json({}));
    await requestApi({
      baseUrl: 'http://api:3000',
      path: '/api/auth/me',
      cookie: '',
      fetcher: fetch,
    });
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ accept: 'application/json' });
  });

  it('maps 401 and 404, and treats everything else as unavailable', async () => {
    const call = (response: Response | Error) =>
      requestApi({
        baseUrl: 'http://api:3000',
        path: '/x',
        cookie: '',
        fetcher: fetcher(response),
      });
    expect(await call(new Response(null, { status: 401 }))).toEqual({ ok: false, status: 401 });
    expect(await call(new Response(null, { status: 404 }))).toEqual({ ok: false, status: 404 });
    expect(await call(new Response(null, { status: 503 }))).toEqual({
      ok: false,
      status: 'unavailable',
    });
    expect(await call(new TypeError('fetch failed'))).toEqual({ ok: false, status: 'unavailable' });
  });
});

describe('contentSecurityPolicy', () => {
  it('requires the nonce for scripts and styles, and allows eval in development only', () => {
    const production = contentSecurityPolicy('abc', false);
    expect(production).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(production).toContain("style-src 'self' 'nonce-abc'");
    expect(production).toContain("frame-ancestors 'none'");
    expect(production).not.toContain('unsafe');
    expect(contentSecurityPolicy('abc', true)).toContain("'unsafe-eval'");
  });
});
