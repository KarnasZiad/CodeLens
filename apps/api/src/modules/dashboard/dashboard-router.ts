import { Router, type Response } from 'express';
import { z } from 'zod';
import { HttpProblem } from '../../lib/problem.js';
import { sessionOf } from '../auth/auth-router.js';
import type { DashboardRepository } from './dashboard-repository.js';

const name = z.string().regex(/^[\w.-]{1,100}$/);
const pullsQuery = z.object({ state: z.enum(['open', 'all']).default('open') }).strict();
const trendsQuery = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }).strict();
const runId = z.uuid();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpProblem(400, z.prettifyError(parsed.error));
  return parsed.data;
}

/**
 * Dashboard data, filtered by the repositories the user can see on GitHub. Anything else answers
 * 404, exactly like a repository that does not exist: nothing reveals that it is installed.
 */
export function dashboardRouter(dashboard: DashboardRepository): Router {
  const router = Router();

  async function visibleRepository(response: Response, owner: string, repo: string) {
    const fullName = `${parse(name, owner)}/${parse(name, repo)}`;
    const repository = await dashboard.findRepository(fullName);
    if (!repository || !sessionOf(response).repositoryIds.includes(repository.id)) {
      throw new HttpProblem(404);
    }
    return repository;
  }

  router.get('/repositories', async (_request, response) => {
    response.json({ items: await dashboard.listRepositories(sessionOf(response).repositoryIds) });
  });

  router.get('/repositories/:owner/:repo/pulls', async (request, response) => {
    const repository = await visibleRepository(response, request.params.owner, request.params.repo);
    const { state } = parse(pullsQuery, request.query);
    response.json({ repository, items: await dashboard.listPullRequests(repository.id, state) });
  });

  router.get('/repositories/:owner/:repo/trends', async (request, response) => {
    const repository = await visibleRepository(response, request.params.owner, request.params.repo);
    const { days } = parse(trendsQuery, request.query);
    response.json(await dashboard.trends(repository.id, days));
  });

  router.get('/runs/:id', async (request, response) => {
    const id = runId.safeParse(request.params.id);
    const run = id.success ? await dashboard.findRun(id.data) : null;
    if (!run || !sessionOf(response).repositoryIds.includes(run.repository.id)) {
      throw new HttpProblem(404);
    }
    response.json(run);
  });

  return router;
}
