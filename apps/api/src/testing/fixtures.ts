import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { createApp } from '../app.js';
import { sign } from '../lib/signature.js';
import { WebhookHandler } from '../modules/webhooks/webhook-handler.js';
import { MemoryReviewRepository } from './memory-review-repository.js';
import { MemoryDeliveryStore, MemoryQueue } from './memory-stores.js';

export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
export const silentLogger = pino({ level: 'silent' });

export const SHA = 'a'.repeat(40);
export const NEXT_SHA = 'b'.repeat(40);
export const INSTALLATION_ID = 42;
export const REPOSITORY_ID = 1001;
export const PULL_REQUEST_ID = 5001;

export function installationPayload(action = 'created') {
  return {
    action,
    installation: { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization' } },
    repositories: [{ id: REPOSITORY_ID, full_name: 'acme/shop', private: true }],
  };
}

export function pullRequestPayload(
  overrides: {
    action?: string;
    sha?: string;
    draft?: boolean;
    state?: 'open' | 'closed';
    merged?: boolean;
  } = {},
) {
  return {
    action: overrides.action ?? 'opened',
    installation: { id: INSTALLATION_ID },
    repository: {
      id: REPOSITORY_ID,
      full_name: 'acme/shop',
      private: true,
      default_branch: 'main',
      owner: { login: 'acme', type: 'Organization' },
    },
    pull_request: {
      id: PULL_REQUEST_ID,
      number: 7,
      title: 'Add the cart',
      user: { login: 'amina' },
      state: overrides.state ?? 'open',
      merged: overrides.merged ?? false,
      draft: overrides.draft ?? false,
      head: { sha: overrides.sha ?? SHA, ref: 'feat/cart' },
      base: { ref: 'main' },
      // Fields CodeLens does not use are stripped by the schema.
      body: 'Closes #12',
    },
  };
}

/** Headers of a genuine GitHub delivery for the given body. */
export function githubHeaders(event: string, body: string, deliveryId: string = randomUUID()) {
  return {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': deliveryId,
    'x-hub-signature-256': sign(WEBHOOK_SECRET, body),
  };
}

export function createTestApp() {
  const reviews = new MemoryReviewRepository();
  const queue = new MemoryQueue();
  const deliveries = new MemoryDeliveryStore();
  const health: Record<string, () => Promise<unknown>> = { postgres: () => Promise.resolve() };
  const app = createApp({
    config: {
      GITHUB_WEBHOOK_SECRETS: ['previous-secret-rotated-out-soon', WEBHOOK_SECRET],
      TRUST_PROXY_HOPS: 0,
    },
    logger: silentLogger,
    deliveries,
    webhooks: new WebhookHandler({ reviews, queue, logger: silentLogger }),
    health,
  });
  return { app, reviews, queue, deliveries, health };
}
