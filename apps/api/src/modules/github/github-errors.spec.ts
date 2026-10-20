import { RequestError } from '@octokit/request-error';
import { describe, expect, it } from 'vitest';
import { PermanentProviderError, RateLimitedError } from './git-provider.js';
import { classifyGitHubError } from './github-errors.js';

function githubError(
  status: number,
  headers: Record<string, string> = {},
  message = 'GitHub error',
) {
  return new RequestError(message, status, {
    request: { method: 'GET', url: 'https://api.github.com/repos/acme/shop', headers: {} },
    response: { status, url: 'https://api.github.com/repos/acme/shop', headers, data: {} },
  });
}

describe('classifyGitHubError', () => {
  const now = () => 1_000_000;

  it('waits until the primary rate limit resets', () => {
    const error = classifyGitHubError(
      githubError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1030' }),
      now,
    );
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(30_000);
  });

  it('follows retry-after, and waits a minute on secondary limits without it', () => {
    expect(classifyGitHubError(githubError(429, { 'retry-after': '12' }), now)).toMatchObject({
      retryAfterMs: 12_000,
    });
    expect(
      classifyGitHubError(githubError(403, {}, 'You have exceeded a secondary rate limit'), now),
    ).toMatchObject({
      retryAfterMs: 60_000,
    });
    expect(classifyGitHubError(githubError(429), now)).toMatchObject({ retryAfterMs: 60_000 });
  });

  it('never waits more than an hour, nor less than a second', () => {
    expect(classifyGitHubError(githubError(429, { 'retry-after': '999999' }), now)).toMatchObject({
      retryAfterMs: 3_600_000,
    });
    expect(
      classifyGitHubError(
        githubError(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }),
        now,
      ),
    ).toMatchObject({ retryAfterMs: 1000 });
  });

  it('stops on client errors and lets server errors be retried', () => {
    expect(
      classifyGitHubError(githubError(403, { 'x-ratelimit-remaining': '4000' })),
    ).toBeInstanceOf(PermanentProviderError);
    expect(classifyGitHubError(githubError(404))).toMatchObject({ status: 404 });
    const server = githubError(502);
    expect(classifyGitHubError(server)).toBe(server);
    const timeout = githubError(408);
    expect(classifyGitHubError(timeout)).toBe(timeout);
    const network = new TypeError('fetch failed');
    expect(classifyGitHubError(network)).toBe(network);
  });
});
