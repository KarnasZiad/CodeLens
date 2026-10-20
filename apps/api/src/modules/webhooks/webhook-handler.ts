import type { Logger } from 'pino';
import type { z } from 'zod';
import { HttpProblem } from '../../lib/problem.js';
import type { ReviewQueue } from '../reviews/review-queue.js';
import type { PullRequestState, ReviewRepository } from '../reviews/review-repository.js';
import {
  installationEvent,
  installationRepositoriesEvent,
  pullRequestEvent,
  REVIEWED_ACTIONS,
} from './events.js';

export type WebhookOutcome =
  | { status: 'queued'; runId: string }
  | { status: 'synced' }
  | { status: 'ignored'; reason: string };

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new HttpProblem(400, 'Payload does not match the event');
  return result.data;
}

/** Turns GitHub events into installation updates and queued reviews. Never calls GitHub. */
export class WebhookHandler {
  constructor(
    private readonly deps: { reviews: ReviewRepository; queue: ReviewQueue; logger: Logger },
  ) {}

  async handle(event: string, payload: unknown): Promise<WebhookOutcome> {
    switch (event) {
      case 'ping':
        return { status: 'ignored', reason: 'ping' };
      case 'installation':
        return this.installation(payload);
      case 'installation_repositories':
        return this.installationRepositories(payload);
      case 'pull_request':
        return this.pullRequest(payload);
      default:
        return { status: 'ignored', reason: `event ${event} is not used` };
    }
  }

  private async installation(payload: unknown): Promise<WebhookOutcome> {
    const { action, installation, repositories } = parse(installationEvent, payload);
    const { reviews } = this.deps;
    switch (action) {
      case 'created':
        await reviews.upsertInstallation({
          id: installation.id,
          accountLogin: installation.account.login,
          accountType: installation.account.type,
        });
        await reviews.upsertRepositories(
          (repositories ?? []).map((repository) => ({
            id: repository.id,
            installationId: installation.id,
            fullName: repository.full_name,
            private: repository.private,
          })),
        );
        return { status: 'synced' };
      case 'deleted':
        // The account removed the app: everything known about it goes away.
        await reviews.deleteInstallation(installation.id);
        return { status: 'synced' };
      case 'suspend':
      case 'unsuspend':
        await reviews.setInstallationSuspended(installation.id, action === 'suspend');
        return { status: 'synced' };
      default:
        return { status: 'ignored', reason: `installation.${action}` };
    }
  }

  private async installationRepositories(payload: unknown): Promise<WebhookOutcome> {
    const event = parse(installationRepositoriesEvent, payload);
    const { reviews } = this.deps;
    await reviews.upsertInstallation({
      id: event.installation.id,
      accountLogin: event.installation.account.login,
      accountType: event.installation.account.type,
    });
    await reviews.upsertRepositories(
      event.repositories_added.map((repository) => ({
        id: repository.id,
        installationId: event.installation.id,
        fullName: repository.full_name,
        private: repository.private,
      })),
    );
    await reviews.deleteRepositories(event.repositories_removed.map((repository) => repository.id));
    return { status: 'synced' };
  }

  private async pullRequest(payload: unknown): Promise<WebhookOutcome> {
    const { action, installation, repository, pull_request: pr } = parse(pullRequestEvent, payload);
    const { reviews, queue, logger } = this.deps;
    const state: PullRequestState = pr.merged ? 'merged' : pr.state;

    // The app may have been installed before CodeLens stored anything: create what is missing.
    await reviews.upsertInstallation({
      id: installation.id,
      accountLogin: repository.owner.login,
      accountType: repository.owner.type,
    });
    await reviews.upsertRepositories([
      {
        id: repository.id,
        installationId: installation.id,
        fullName: repository.full_name,
        private: repository.private,
        defaultBranch: repository.default_branch ?? null,
      },
    ]);
    await reviews.upsertPullRequest({
      id: pr.id,
      repositoryId: repository.id,
      number: pr.number,
      title: pr.title,
      authorLogin: pr.user.login,
      state,
      draft: pr.draft,
      headSha: pr.head.sha,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
    });

    if (!REVIEWED_ACTIONS.has(action)) return { status: 'synced' };
    if (pr.draft) return { status: 'ignored', reason: 'draft pull request' };
    if (state !== 'open') return { status: 'ignored', reason: 'pull request is not open' };

    const { run, created } = await reviews.createRun(pr.id, pr.head.sha);
    if (!created && (run.status === 'completed' || run.status === 'failed')) {
      return { status: 'ignored', reason: 'commit already reviewed' };
    }
    await queue.enqueue(run.id);
    logger.info(
      { runId: run.id, repository: repository.full_name, pullRequest: pr.number },
      'review queued',
    );
    return { status: 'queued', runId: run.id };
  }
}
