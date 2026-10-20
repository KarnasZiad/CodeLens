import { SUMMARY_MARKER } from '@codelens/review-engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGitProvider } from '../../testing/fake-git-provider.js';
import { NEXT_SHA, pullRequestPayload, SHA, silentLogger } from '../../testing/fixtures.js';
import { MemoryReviewRepository } from '../../testing/memory-review-repository.js';
import { MemoryQueue, MemoryReportStore } from '../../testing/memory-stores.js';
import { WebhookHandler } from '../webhooks/webhook-handler.js';
import { LIMITS, ReviewProcessor } from './review-processor.js';

const patch = (lines: string[]) =>
  [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');

let reviews: MemoryReviewRepository;
let reports: MemoryReportStore;
let provider: FakeGitProvider;
let processor: ReviewProcessor;
let runId: string;

async function queuePullRequest(sha = SHA): Promise<string> {
  const queue = new MemoryQueue();
  const outcome = await new WebhookHandler({ reviews, queue, logger: silentLogger }).handle(
    'pull_request',
    pullRequestPayload({ action: 'synchronize', sha }),
  );
  if (outcome.status !== 'queued') throw new Error('expected a queued review');
  return outcome.runId;
}

beforeEach(async () => {
  reviews = new MemoryReviewRepository();
  reports = new MemoryReportStore();
  provider = new FakeGitProvider();
  processor = new ReviewProcessor({ reviews, reports, provider, logger: silentLogger });
  runId = await queuePullRequest();
});

describe('ReviewProcessor', () => {
  it('publishes a failed gate with annotations, a summary comment and a stored report', async () => {
    provider.files = [
      {
        path: 'src/cart.ts',
        status: 'modified',
        additions: 2,
        deletions: 0,
        patch: patch(['debugger;', 'it.only("x", () => {});']),
      },
      {
        path: 'src/cart.spec.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: patch(['it("y", () => {});']),
      },
    ];

    expect(await processor.process(runId)).toBe('completed');

    const [check] = provider.checks.values();
    expect(check?.externalId).toBe(runId);
    expect(check?.ref).toMatchObject({ owner: 'acme', repo: 'shop', number: 7, headSha: SHA });
    expect(check?.result).toMatchObject({
      conclusion: 'failure',
      title: 'Quality gate en échec · 2 constats',
    });
    expect(check?.result?.annotations.map((annotation) => annotation.annotation_level)).toEqual([
      'failure',
      'warning',
    ]);
    expect(provider.comments).toHaveLength(1);
    expect(provider.comments[0]?.body.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(provider.comments[0]?.body).toContain(
      `https://github.com/acme/shop/blob/${SHA}/src/cart.ts#L1`,
    );

    const run = reviews.runs.get(runId);
    expect(run).toMatchObject({ status: 'completed', conclusion: 'failure', gateStatus: 'failed' });
    expect(run?.findings.map((finding) => finding.rule)).toEqual(['focused-test', 'debugger']);
    expect(reports.reports.get(runId)).toMatchObject({
      repository: 'acme/shop',
      pullRequest: 7,
      headSha: SHA,
      configSource: 'default',
    });
  });

  it('passes a clean pull request', async () => {
    provider.files = [
      {
        path: 'README.md',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: patch(['Hello']),
      },
    ];
    await processor.process(runId);
    const [check] = provider.checks.values();
    expect(check?.result).toMatchObject({
      conclusion: 'success',
      title: 'Quality gate réussie · aucun constat',
    });
    expect(reviews.runs.get(runId)?.gateStatus).toBe('passed');
  });

  it('reads the configuration from the base branch, never from the pull request', async () => {
    provider.setContent(
      'main',
      '.codelens.yml',
      'analyzers:\n  debug-statements:\n    enabled: false\n',
    );
    provider.setContent(SHA, '.codelens.yml', 'gate:\n  maxFindings:\n    critical: null\n');
    provider.files = [
      {
        path: 'src/cart.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: patch(['debugger;']),
      },
      {
        path: '.codelens.yml',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: patch(['gate: {}']),
      },
    ];

    await processor.process(runId);

    expect(provider.reads).toContain('main:.codelens.yml');
    expect(provider.reads).not.toContain(`${SHA}:.codelens.yml`);
    expect(reviews.runs.get(runId)?.findings.map((finding) => finding.rule)).toEqual([
      'config-changed',
    ]);
    expect(reports.reports.get(runId)?.configSource).toBe('file');
  });

  it('explains an invalid configuration in a neutral check', async () => {
    provider.setContent('main', '.codelens.yml', 'analyzers:\n  complexity:\n    treshold: 5\n');

    await processor.process(runId);

    const [check] = provider.checks.values();
    expect(check?.result?.conclusion).toBe('neutral');
    expect(check?.result?.summary).toContain('configuration invalide');
    expect(check?.result?.summary).toContain('treshold');
    expect(provider.comments[0]?.body).toContain('configuration invalide');
    expect(reviews.runs.get(runId)).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      gateStatus: null,
    });
    expect(reports.reports.get(runId)).toMatchObject({ configSource: 'invalid', result: null });
  });

  it('loads the content the analyzers need, from the reviewed commit and within limits', async () => {
    const complex = [
      'export function route(path) {',
      ...Array.from({ length: 11 }, (_, index) => `  if (path === '/p${index}') return ${index};`),
      '  return -1;',
      '}',
    ];
    provider.files = [
      {
        path: 'src/router.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '@@ -2,1 +2,1 @@\n-x\n+y',
      },
      { path: 'src/huge.ts', status: 'modified', additions: 1, deletions: 0, patch: patch(['x']) },
    ];
    provider.setContent(SHA, 'src/router.ts', complex.join('\n'));
    provider.setContent(SHA, 'src/huge.ts', 'x'.repeat(LIMITS.contentBytes + 1));

    await processor.process(runId);

    expect(provider.reads).toEqual(
      expect.arrayContaining([`${SHA}:src/router.ts`, `${SHA}:src/huge.ts`]),
    );
    expect(reviews.runs.get(runId)?.findings.map((finding) => finding.rule)).toContain(
      'cyclomatic-complexity',
    );
  });

  it('marks the review partial when the pull request has too many files', async () => {
    provider.files = Array.from({ length: LIMITS.files + 5 }, (_, index) => ({
      path: `docs/page-${index}.md`,
      status: 'added' as const,
      additions: 1,
      deletions: 0,
      patch: patch(['text']),
    }));
    await processor.process(runId);
    const [check] = provider.checks.values();
    expect(check?.result?.summary).toContain('Analyse partielle');
  });

  it('still completes the check of an outdated commit, but leaves the comment to the newer one', async () => {
    await queuePullRequest(NEXT_SHA);
    await processor.process(runId);
    const [check] = provider.checks.values();
    expect(check?.result?.conclusion).toBe('success');
    expect(provider.comments).toHaveLength(0);
  });

  it('reuses its check on a retry and skips completed runs', async () => {
    provider.failures.set('listFiles', new Error('GitHub 502'));
    await expect(processor.process(runId)).rejects.toThrow('GitHub 502');
    expect(provider.checks.size).toBe(1);

    await processor.process(runId);
    expect(provider.checks.size).toBe(1);
    expect(reviews.runs.get(runId)?.status).toBe('completed');

    expect(await processor.process(runId)).toBe('skipped');
    expect(await processor.process('00000000-0000-0000-0000-000000000000')).toBe('skipped');
  });

  it('closes the check as neutral when the last attempt fails', async () => {
    provider.failures.set('listFiles', new Error('GitHub 502'));
    await processor.process(runId).catch(() => undefined);

    await processor.fail(runId, new Error('GitHub 502'));

    const [check] = provider.checks.values();
    expect(check?.result).toMatchObject({ conclusion: 'neutral', title: 'Analyse impossible' });
    expect(reviews.runs.get(runId)).toMatchObject({
      status: 'failed',
      conclusion: 'neutral',
      error: 'GitHub 502',
    });
  });

  it('records a failure even when no check was created or GitHub stays down', async () => {
    await processor.fail(runId, 'boom');
    expect(reviews.runs.get(runId)).toMatchObject({ status: 'failed', error: 'boom' });
    expect(provider.checks.size).toBe(0);

    const other = await queuePullRequest(NEXT_SHA);
    await reviews.setCheckRun(
      other,
      await provider.startCheck(
        { installationId: 42, owner: 'acme', repo: 'shop', number: 7, headSha: NEXT_SHA },
        other,
      ),
    );
    provider.failures.set('completeCheck', new Error('still down'));
    await expect(processor.fail(other, new Error('GitHub 502'))).resolves.toBeUndefined();
    expect(reviews.runs.get(other)?.status).toBe('failed');
  });
});
