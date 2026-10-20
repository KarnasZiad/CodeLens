import {
  CONFIG_PATH,
  filesNeedingContent,
  parseConfig,
  renderConfigErrors,
  renderSummary,
  runReview,
  summaryTitle,
} from '@codelens/review-engine';
import type { Logger } from 'pino';
import { toAnnotations } from '../github/annotations.js';
import type { GitProvider, PullRequestRef } from '../github/git-provider.js';
import type { ReportStore } from './report-store.js';
import type { ReviewRepository, RunContext } from './review-repository.js';

export const LIMITS = {
  /** Changed files listed per pull request. */
  files: 300,
  /** Files whose content is loaded for the content-based analyzers. */
  contentFiles: 50,
  contentBytes: 200 * 1024,
  configBytes: 64 * 1024,
  /** Parallel content downloads, to stay polite with the GitHub API. */
  downloads: 5,
} as const;

export interface ReviewProcessorDeps {
  reviews: ReviewRepository;
  reports: ReportStore;
  provider: GitProvider;
  logger: Logger;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function pullRequestRef(context: RunContext): PullRequestRef {
  const [owner = '', repo = ''] = context.repository.fullName.split('/');
  return {
    installationId: context.repository.installationId,
    owner,
    repo,
    number: context.pullRequest.number,
    headSha: context.run.headSha,
  };
}

/**
 * One review, from the queued run to the published check. GitHub is updated before the run is
 * marked completed, so a retry after a crash publishes again instead of leaving the check pending.
 */
export class ReviewProcessor {
  constructor(private readonly deps: ReviewProcessorDeps) {}

  async process(runId: string): Promise<'completed' | 'skipped'> {
    const { reviews, reports, provider } = this.deps;
    const context = await reviews.findRunContext(runId);
    if (!context || context.run.status === 'completed') return 'skipped';
    const logger = this.deps.logger.child({ runId, repository: context.repository.fullName });

    await reviews.startRun(runId);
    const ref = pullRequestRef(context);
    let checkRunId = context.run.checkRunId;
    if (checkRunId === null) {
      checkRunId = await provider.startCheck(ref, runId);
      await reviews.setCheckRun(runId, checkRunId);
    }
    // A newer push may have arrived: the check still completes, but the comment belongs to it.
    const current = context.pullRequest.headSha === context.run.headSha;

    // From the base branch: the pull request under review cannot relax its own rules.
    const configText = await provider.readFile(
      ref,
      CONFIG_PATH,
      context.pullRequest.baseRef,
      LIMITS.configBytes,
    );
    const parsed = parseConfig(configText);
    const report = {
      runId,
      repository: context.repository.fullName,
      pullRequest: context.pullRequest.number,
      headSha: context.run.headSha,
      createdAt: new Date(),
    };

    if (!parsed.ok) {
      const summary = renderConfigErrors(parsed.errors);
      await provider.completeCheck(ref, checkRunId, {
        conclusion: 'neutral',
        title: 'Configuration .codelens.yml invalide',
        summary,
        annotations: [],
      });
      if (current) await provider.upsertSummaryComment(ref, summary);
      await reports.save({
        ...report,
        configSource: 'invalid',
        config: null,
        configErrors: parsed.errors,
        result: null,
      });
      await reviews.completeRun(runId, { conclusion: 'neutral', result: null });
      logger.info({ errors: parsed.errors.length }, 'invalid configuration');
      return 'completed';
    }

    const { files, truncated } = await provider.listFiles(ref, LIMITS.files);
    const wanted = filesNeedingContent(files, parsed.config);
    const loaded = await mapLimited(
      wanted.slice(0, LIMITS.contentFiles),
      LIMITS.downloads,
      async (path) => {
        const content = await provider.readFile(
          ref,
          path,
          context.run.headSha,
          LIMITS.contentBytes,
        );
        return [path, content] as const;
      },
    );
    const contents = new Map(
      loaded.filter((entry): entry is readonly [string, string] => entry[1] !== null),
    );

    const result = runReview(
      {
        pullRequest: {
          title: context.pullRequest.title,
          author: context.pullRequest.authorLogin,
          baseRef: context.pullRequest.baseRef,
          headRef: context.pullRequest.headRef,
        },
        files,
        contents,
        truncated: truncated || wanted.length > LIMITS.contentFiles,
      },
      parsed.config,
    );
    const summary = renderSummary(result, {
      fileUrl: (path, line) => provider.fileUrl(ref, path, line),
    });
    const conclusion = result.gate.status === 'passed' ? 'success' : 'failure';

    await provider.completeCheck(ref, checkRunId, {
      conclusion,
      title: summaryTitle(result),
      summary,
      annotations: toAnnotations(result.findings),
    });
    if (current) await provider.upsertSummaryComment(ref, summary);
    await reports.save({
      ...report,
      configSource: parsed.source,
      config: parsed.config,
      configErrors: [],
      result,
    });
    await reviews.completeRun(runId, { conclusion, result });
    logger.info(
      { gate: result.gate.status, findings: result.findings.length, durationMs: result.durationMs },
      'review completed',
    );
    return 'completed';
  }

  /** Last attempt failed: tell the developers, without blocking their merge. */
  async fail(runId: string, error: unknown): Promise<void> {
    const { reviews, provider, logger } = this.deps;
    const message = error instanceof Error ? error.message : String(error);
    await reviews.failRun(runId, message.slice(0, 1000));
    const context = await reviews.findRunContext(runId);
    const checkRunId = context?.run.checkRunId ?? null;
    if (!context || checkRunId === null) return;
    try {
      await provider.completeCheck(pullRequestRef(context), checkRunId, {
        conclusion: 'neutral',
        title: 'Analyse impossible',
        summary:
          'CodeLens n’a pas pu analyser cette PR après plusieurs tentatives. Ce check ne bloque pas la fusion ; poussez un nouveau commit pour relancer l’analyse.',
        annotations: [],
      });
    } catch (publishError) {
      logger.warn({ err: publishError, runId }, 'could not close the check of a failed review');
    }
  }
}
