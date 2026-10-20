import express, { Router } from 'express';
import type { Logger } from 'pino';
import { HttpProblem } from '../../lib/problem.js';
import { verifySignature } from '../../lib/signature.js';
import type { DeliveryStore } from './delivery-store.js';
import type { WebhookHandler } from './webhook-handler.js';

/** GitHub sends at most 25 MB; CodeLens events are a few kilobytes. */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

const EVENT = /^[a-z_]{1,64}$/;
const DELIVERY = /^[0-9a-f-]{36}$/i;

interface WebhookRouterDeps {
  secrets: readonly string[];
  deliveries: DeliveryStore;
  handler: WebhookHandler;
  logger: Logger;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

function numericId(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || !('id' in value)) return null;
  return typeof value.id === 'number' ? value.id : null;
}

/**
 * POST /webhooks/github. The signature is checked on the raw bytes before anything else; the
 * response never waits for a review, which runs in the queue.
 */
export function webhookRouter({ secrets, deliveries, handler, logger }: WebhookRouterDeps): Router {
  const router = Router();

  router.post(
    '/',
    express.raw({ type: () => true, limit: MAX_WEBHOOK_BYTES }),
    async (request, response) => {
      const body: unknown = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpProblem(400, 'Empty body');
      if (!verifySignature(body, header(request.headers['x-hub-signature-256']), secrets)) {
        throw new HttpProblem(401, 'Invalid signature');
      }
      if (!request.is('application/json')) throw new HttpProblem(415, 'Expected application/json');

      const event = header(request.headers['x-github-event']) ?? '';
      const deliveryId = header(request.headers['x-github-delivery']) ?? '';
      if (!EVENT.test(event) || !DELIVERY.test(deliveryId)) {
        throw new HttpProblem(400, 'Missing or invalid GitHub headers');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        throw new HttpProblem(400, 'Body is not valid JSON');
      }
      const fields = typeof payload === 'object' && payload !== null ? payload : {};
      const log = logger.child({ deliveryId, event });

      const fresh = await deliveries.begin({
        id: deliveryId,
        event,
        action: 'action' in fields && typeof fields.action === 'string' ? fields.action : null,
        installationId: 'installation' in fields ? numericId(fields.installation) : null,
        repositoryId: 'repository' in fields ? numericId(fields.repository) : null,
        payload,
        receivedAt: new Date(),
      });
      if (!fresh) {
        log.info('duplicate delivery');
        response.status(200).json({ status: 'duplicate' });
        return;
      }

      try {
        const outcome = await handler.handle(event, payload);
        await deliveries.finish(deliveryId, outcome.status === 'ignored' ? 'ignored' : 'processed');
        log.info({ outcome }, 'webhook handled');
        response.status(202).json(outcome);
      } catch (error) {
        // Not marked processed: a redelivery from GitHub will try again.
        await deliveries.fail(deliveryId, error instanceof Error ? error.message : String(error));
        if (error instanceof HttpProblem) throw error;
        log.error({ err: error }, 'webhook failed');
        throw new HttpProblem(503, 'Temporarily unable to handle the event; redeliver it later');
      }
    },
  );

  return router;
}
