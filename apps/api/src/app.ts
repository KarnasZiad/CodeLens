import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { ApiConfig } from './config.js';
import { errorHandler, notFound } from './lib/problem.js';
import { type HealthChecks, healthRouter } from './modules/health/health-router.js';
import type { DeliveryStore } from './modules/webhooks/delivery-store.js';
import type { WebhookHandler } from './modules/webhooks/webhook-handler.js';
import { webhookRouter } from './modules/webhooks/webhook-router.js';

export interface AppDeps {
  config: Pick<ApiConfig, 'GITHUB_WEBHOOK_SECRETS' | 'TRUST_PROXY_HOPS'>;
  logger: Logger;
  deliveries: DeliveryStore;
  webhooks: WebhookHandler;
  health: HealthChecks;
}

const REQUEST_ID = /^[\w-]{1,64}$/;

/** Composition root of the HTTP API: every dependency is injected, so tests use in-memory ones. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(
    pinoHttp({
      logger: deps.logger,
      // An incoming identifier is kept only if it is well formed, so logs cannot be forged.
      genReqId: (request, response) => {
        const incoming = request.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        response.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (request) => request.url.startsWith('/health') },
    }),
  );

  app.use('/health', healthRouter(deps.health));
  app.use(
    '/webhooks/github',
    webhookRouter({
      secrets: deps.config.GITHUB_WEBHOOK_SECRETS,
      deliveries: deps.deliveries,
      handler: deps.webhooks,
      logger: deps.logger,
    }),
  );

  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}
