import { describe, expect, it } from 'vitest';
import {
  installationPayload,
  NEXT_SHA,
  pullRequestPayload,
  silentLogger,
} from '../../testing/fixtures.js';
import { MemoryReviewRepository } from '../../testing/memory-review-repository.js';
import { MemoryQueue } from '../../testing/memory-stores.js';
import { WebhookHandler } from './webhook-handler.js';

function setup() {
  const reviews = new MemoryReviewRepository();
  const queue = new MemoryQueue();
  return { reviews, queue, handler: new WebhookHandler({ reviews, queue, logger: silentLogger }) };
}

describe('WebhookHandler', () => {
  describe('installations', () => {
    it('stores a new installation with its repositories', async () => {
      const { handler, reviews } = setup();
      expect(await handler.handle('installation', installationPayload())).toEqual({
        status: 'synced',
      });
      expect(reviews.installations.get(42)).toMatchObject({
        accountLogin: 'acme',
        accountType: 'Organization',
      });
      expect(reviews.repositories.get(1001)).toMatchObject({
        fullName: 'acme/shop',
        installationId: 42,
      });
    });

    it('forgets everything about an uninstalled account', async () => {
      const { handler, reviews } = setup();
      await handler.handle('installation', installationPayload());
      await handler.handle('pull_request', pullRequestPayload());

      await handler.handle('installation', installationPayload('deleted'));

      expect(reviews.installations.size).toBe(0);
      expect(reviews.repositories.size).toBe(0);
      expect(reviews.pullRequests.size).toBe(0);
      expect(reviews.runs.size).toBe(0);
    });

    it('tracks suspension and ignores other actions', async () => {
      const { handler, reviews } = setup();
      await handler.handle('installation', installationPayload());
      await handler.handle('installation', installationPayload('suspend'));
      expect(reviews.installations.get(42)?.suspended).toBe(true);
      await handler.handle('installation', installationPayload('unsuspend'));
      expect(reviews.installations.get(42)?.suspended).toBe(false);
      expect(
        await handler.handle('installation', installationPayload('new_permissions_accepted')),
      ).toEqual({
        status: 'ignored',
        reason: 'installation.new_permissions_accepted',
      });
    });

    it('adds and removes repositories of an installation', async () => {
      const { handler, reviews } = setup();
      await handler.handle('installation', installationPayload());
      await handler.handle('installation_repositories', {
        action: 'added',
        installation: { id: 42, account: { login: 'acme', type: 'Organization' } },
        repositories_added: [{ id: 1002, full_name: 'acme/api', private: false }],
        repositories_removed: [],
      });
      expect([...reviews.repositories.keys()]).toEqual([1001, 1002]);

      await handler.handle('installation_repositories', {
        action: 'removed',
        installation: { id: 42, account: { login: 'acme', type: 'Organization' } },
        repositories_removed: [{ id: 1001 }],
      });
      expect([...reviews.repositories.keys()]).toEqual([1002]);
    });
  });

  describe('pull requests', () => {
    it('creates the missing installation and repository from the event itself', async () => {
      const { handler, reviews, queue } = setup();
      const outcome = await handler.handle('pull_request', pullRequestPayload());
      expect(outcome.status).toBe('queued');
      expect(reviews.installations.get(42)?.accountLogin).toBe('acme');
      expect(reviews.repositories.get(1001)?.defaultBranch).toBe('main');
      expect(queue.enqueued).toHaveLength(1);
    });

    it('queues one review per commit', async () => {
      const { handler, queue, reviews } = setup();
      await handler.handle('pull_request', pullRequestPayload());
      await handler.handle('pull_request', pullRequestPayload({ action: 'reopened' }));
      expect(queue.enqueued).toHaveLength(1);

      await handler.handle(
        'pull_request',
        pullRequestPayload({ action: 'synchronize', sha: NEXT_SHA }),
      );
      expect(queue.enqueued).toHaveLength(2);
      expect(reviews.pullRequests.get(5001)?.headSha).toBe(NEXT_SHA);
    });

    it('does not review a commit twice once its review is over', async () => {
      const { handler, queue, reviews } = setup();
      await handler.handle('pull_request', pullRequestPayload());
      const [run] = reviews.runs.values();
      if (run) run.status = 'completed';

      expect(
        await handler.handle('pull_request', pullRequestPayload({ action: 'reopened' })),
      ).toEqual({
        status: 'ignored',
        reason: 'commit already reviewed',
      });
      expect(queue.enqueued).toHaveLength(1);
    });

    it('skips drafts until they are ready for review', async () => {
      const { handler, queue } = setup();
      expect(await handler.handle('pull_request', pullRequestPayload({ draft: true }))).toEqual({
        status: 'ignored',
        reason: 'draft pull request',
      });
      expect(queue.enqueued).toHaveLength(0);
      expect(
        (await handler.handle('pull_request', pullRequestPayload({ action: 'ready_for_review' })))
          .status,
      ).toBe('queued');
    });

    it('records closing and merging without reviewing', async () => {
      const { handler, reviews, queue } = setup();
      await handler.handle(
        'pull_request',
        pullRequestPayload({ action: 'closed', state: 'closed', merged: true }),
      );
      expect(reviews.pullRequests.get(5001)?.state).toBe('merged');
      expect(
        await handler.handle(
          'pull_request',
          pullRequestPayload({ action: 'reopened', state: 'closed' }),
        ),
      ).toEqual({ status: 'ignored', reason: 'pull request is not open' });
      expect(
        await handler.handle('pull_request', pullRequestPayload({ action: 'edited' })),
      ).toEqual({
        status: 'synced',
      });
      expect(queue.enqueued).toHaveLength(0);
    });

    it('rejects payloads with an invalid commit or repository name', async () => {
      const { handler } = setup();
      const payload = pullRequestPayload({ sha: 'not-a-sha' });
      await expect(handler.handle('pull_request', payload)).rejects.toMatchObject({ status: 400 });
      const evil = pullRequestPayload();
      evil.repository.full_name = '../../etc/passwd';
      await expect(handler.handle('pull_request', evil)).rejects.toMatchObject({ status: 400 });
    });
  });
});
