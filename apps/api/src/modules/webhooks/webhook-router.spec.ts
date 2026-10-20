import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sign } from '../../lib/signature.js';
import {
  createTestApp,
  githubHeaders,
  installationPayload,
  pullRequestPayload,
  WEBHOOK_SECRET,
} from '../../testing/fixtures.js';
import { MAX_WEBHOOK_BYTES } from './webhook-router.js';

function deliver(
  app: ReturnType<typeof createTestApp>['app'],
  event: string,
  payload: unknown,
  deliveryId?: string,
) {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/webhooks/github')
    .set(githubHeaders(event, body, deliveryId))
    .send(body);
}

describe('POST /webhooks/github', () => {
  it('accepts a signed pull request event and queues a review', async () => {
    const { app, queue, reviews, deliveries } = createTestApp();
    await deliver(app, 'installation', installationPayload());

    const response = await deliver(app, 'pull_request', pullRequestPayload());

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'queued', runId: expect.any(String) });
    expect(queue.enqueued).toEqual([response.body.runId]);
    expect(reviews.pullRequests.get(5001)).toMatchObject({ number: 7, headSha: 'a'.repeat(40) });
    const delivery = [...deliveries.deliveries.values()].at(-1);
    expect(delivery).toMatchObject({
      event: 'pull_request',
      action: 'opened',
      installationId: 42,
      repositoryId: 1001,
      status: 'processed',
    });
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'sha1=abc'],
    ['forged', sign('another-secret-of-the-attacker', '{}')],
  ])('rejects a %s signature with 401 and records nothing', async (_case, signature) => {
    const { app, deliveries } = createTestApp();
    const body = JSON.stringify(pullRequestPayload());
    const headers: Record<string, string> = { ...githubHeaders('pull_request', body) };
    if (signature === undefined) delete headers['x-hub-signature-256'];
    else headers['x-hub-signature-256'] = signature;

    const response = await request(app).post('/webhooks/github').set(headers).send(body);

    expect(response.status).toBe(401);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toMatchObject({ status: 401, title: 'Unauthorized' });
    expect(deliveries.deliveries.size).toBe(0);
  });

  it('rejects a body altered after signing', async () => {
    const { app } = createTestApp();
    const body = JSON.stringify(pullRequestPayload());
    const headers = githubHeaders('pull_request', body);
    const response = await request(app)
      .post('/webhooks/github')
      .set(headers)
      .send(body.replace('Add the cart', 'Add the carT'));
    expect(response.status).toBe(401);
  });

  it('accepts the previous secret during a rotation', async () => {
    const { app } = createTestApp();
    const body = JSON.stringify({ zen: 'Keep it logically awesome.' });
    const response = await request(app)
      .post('/webhooks/github')
      .set({
        ...githubHeaders('ping', body),
        'x-hub-signature-256': sign('previous-secret-rotated-out-soon', body),
      })
      .send(body);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'ignored', reason: 'ping' });
  });

  it('refuses oversized bodies before verifying them', async () => {
    const { app } = createTestApp();
    const body = JSON.stringify({ padding: 'x'.repeat(MAX_WEBHOOK_BYTES) });
    const response = await request(app)
      .post('/webhooks/github')
      .set(githubHeaders('ping', body))
      .send(body);
    expect(response.status).toBe(413);
  });

  it('validates the content type, the GitHub headers and the JSON once the signature is valid', async () => {
    const { app } = createTestApp();
    const form = 'payload=%7B%7D';
    const notJson = await request(app)
      .post('/webhooks/github')
      .set({ ...githubHeaders('ping', form), 'content-type': 'application/x-www-form-urlencoded' })
      .send(form);
    expect(notJson.status).toBe(415);

    const body = '{}';
    const badEvent = await request(app)
      .post('/webhooks/github')
      .set({ ...githubHeaders('ping', body), 'x-github-event': 'Pull Request' })
      .send(body);
    expect(badEvent.status).toBe(400);

    const badDelivery = await request(app)
      .post('/webhooks/github')
      .set({ ...githubHeaders('ping', body), 'x-github-delivery': '../../etc' })
      .send(body);
    expect(badDelivery.status).toBe(400);

    const truncated = '{"action":';
    const badJson = await request(app)
      .post('/webhooks/github')
      .set(githubHeaders('ping', truncated))
      .send(truncated);
    expect(badJson.status).toBe(400);
    expect(badJson.body.detail).toBe('Body is not valid JSON');

    const empty = await request(app)
      .post('/webhooks/github')
      .set({ ...githubHeaders('ping', ''), 'x-hub-signature-256': sign(WEBHOOK_SECRET, '') })
      .send('');
    expect(empty.status).toBe(400);
  });

  it('answers 200 to a duplicate delivery without queuing again', async () => {
    const { app, queue } = createTestApp();
    const id = randomUUID();
    await deliver(app, 'installation', installationPayload());
    await deliver(app, 'pull_request', pullRequestPayload(), id);

    const again = await deliver(app, 'pull_request', pullRequestPayload(), id);

    expect(again.status).toBe(200);
    expect(again.body).toEqual({ status: 'duplicate' });
    expect(queue.enqueued).toHaveLength(1);
  });

  it('answers 503 when the queue is down, and handles the redelivery once it is back', async () => {
    const { app, queue, deliveries } = createTestApp();
    const id = randomUUID();
    await deliver(app, 'installation', installationPayload());
    queue.failure = new Error('Redis unreachable');

    const failed = await deliver(app, 'pull_request', pullRequestPayload(), id);
    expect(failed.status).toBe(503);
    expect(failed.body.detail).toContain('redeliver');
    expect(deliveries.deliveries.get(id)).toMatchObject({
      status: 'failed',
      error: 'Redis unreachable',
    });

    queue.failure = null;
    const redelivered = await deliver(app, 'pull_request', pullRequestPayload(), id);
    expect(redelivered.status).toBe(202);
    expect(queue.enqueued).toHaveLength(1);
  });

  it('answers 400 to a payload that does not match its event', async () => {
    const { app, deliveries } = createTestApp();
    const id = randomUUID();
    const response = await deliver(app, 'pull_request', { action: 'opened', pull_request: {} }, id);
    expect(response.status).toBe(400);
    expect(deliveries.deliveries.get(id)?.status).toBe('failed');
  });

  it('records unused events as ignored', async () => {
    const { app, deliveries } = createTestApp();
    const id = randomUUID();
    const response = await deliver(app, 'star', { action: 'created' }, id);
    expect(response.body).toEqual({ status: 'ignored', reason: 'event star is not used' });
    expect(deliveries.deliveries.get(id)?.status).toBe('ignored');
  });
});

describe('API surface', () => {
  it('answers unknown routes with a problem, and hides the framework', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/admin');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/admin',
    });
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps a well-formed request id and replaces a forged one', async () => {
    const { app } = createTestApp();
    const kept = await request(app).get('/health/live').set('x-request-id', 'abc-123');
    expect(kept.headers['x-request-id']).toBe('abc-123');
    const replaced = await request(app)
      .get('/health/live')
      .set('x-request-id', 'forged id; level=fatal');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
