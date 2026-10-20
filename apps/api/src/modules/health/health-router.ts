import { Router } from 'express';

/** Each check resolves when its dependency answers, and rejects otherwise. */
export type HealthChecks = Record<string, () => Promise<unknown>>;

function withTimeout(check: () => Promise<unknown>, timeoutMs: number): Promise<'up' | 'down'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve('down');
    }, timeoutMs);
    check().then(
      () => {
        clearTimeout(timer);
        resolve('up');
      },
      () => {
        clearTimeout(timer);
        resolve('down');
      },
    );
  });
}

/** /health/live for the orchestrator restart policy, /health/ready for traffic routing. */
export function healthRouter(checks: HealthChecks, { timeoutMs = 2000 } = {}): Router {
  const router = Router();
  router.get('/live', (_request, response) => {
    response.json({ status: 'up' });
  });
  router.get('/ready', async (_request, response) => {
    const entries = await Promise.all(
      Object.entries(checks).map(
        async ([name, check]) => [name, await withTimeout(check, timeoutMs)] as const,
      ),
    );
    const dependencies = Object.fromEntries(entries);
    const up = entries.every(([, status]) => status === 'up');
    response.status(up ? 200 : 503).json({ status: up ? 'up' : 'down', dependencies });
  });
  return router;
}
