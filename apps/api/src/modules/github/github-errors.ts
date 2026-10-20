import { RequestError } from '@octokit/request-error';
import { PermanentProviderError, RateLimitedError } from './git-provider.js';

const DEFAULT_SECONDARY_WAIT_MS = 60_000;
const MAX_WAIT_MS = 60 * 60_000;

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/**
 * Sorts GitHub errors for the queue: rate limits postpone the job, client errors stop it, and
 * everything else (5xx, network) is retried with backoff.
 */
export function classifyGitHubError(error: unknown, now: () => number = Date.now): unknown {
  if (!(error instanceof RequestError)) return error;
  const headers = error.response?.headers as Record<string, unknown> | undefined;
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  const reset = headerValue(headers, 'x-ratelimit-reset');
  const retryAfter = headerValue(headers, 'retry-after');

  if (error.status === 403 || error.status === 429) {
    if (retryAfter !== undefined) {
      return new RateLimitedError(Math.min(Number(retryAfter) * 1000, MAX_WAIT_MS));
    }
    if (remaining === '0' && reset !== undefined) {
      return new RateLimitedError(
        Math.min(Math.max(Number(reset) * 1000 - now(), 1000), MAX_WAIT_MS),
      );
    }
    if (error.status === 429 || /secondary rate limit/i.test(error.message)) {
      return new RateLimitedError(DEFAULT_SECONDARY_WAIT_MS);
    }
  }
  if (error.status >= 400 && error.status < 500 && error.status !== 408) {
    return new PermanentProviderError(`GitHub answered ${error.status}`, error.status);
  }
  return error;
}
