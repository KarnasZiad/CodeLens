import { Queue, UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { PermanentProviderError, RateLimitedError } from '../github/git-provider.js';
import type { ReviewProcessor } from './review-processor.js';
import { REVIEW_QUEUE, type ReviewJob, type ReviewQueue } from './review-queue.js';

export const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export class BullMqReviewQueue implements ReviewQueue {
  constructor(private readonly queue: Queue<ReviewJob>) {}

  static create(connection: ConnectionOptions): BullMqReviewQueue {
    return new BullMqReviewQueue(new Queue<ReviewJob>(REVIEW_QUEUE, { connection }));
  }

  async enqueue(runId: string): Promise<void> {
    // jobId = runId: BullMQ ignores a job whose identifier already exists.
    await this.queue.add('review', { runId }, { ...JOB_OPTIONS, jobId: runId });
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

/**
 * Runs reviews from the queue. GitHub rate limits pause the whole worker until the reset time
 * without consuming an attempt; permanent errors fail the run at once.
 */
export function startReviewWorker(options: {
  connection: ConnectionOptions;
  processor: ReviewProcessor;
  concurrency: number;
  logger: Logger;
}): { worker: Worker<ReviewJob>; close: () => Promise<void> } {
  const { connection, processor, concurrency, logger } = options;
  // The rate limit is set on the queue: every worker of every replica pauses, not just this one.
  const queue = new Queue<ReviewJob>(REVIEW_QUEUE, { connection });
  const worker = new Worker<ReviewJob>(
    REVIEW_QUEUE,
    async (job: Job<ReviewJob>) => {
      try {
        return await processor.process(job.data.runId);
      } catch (error) {
        if (error instanceof RateLimitedError) {
          logger.warn(
            { runId: job.data.runId, retryAfterMs: error.retryAfterMs },
            'GitHub rate limit',
          );
          await queue.rateLimit(error.retryAfterMs);
          throw Worker.RateLimitError();
        }
        if (error instanceof PermanentProviderError) throw new UnrecoverableError(error.message);
        throw error;
      }
    },
    { connection, concurrency, lockDuration: 120_000 },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const lastAttempt =
      job.attemptsMade >= (job.opts.attempts ?? 1) || error instanceof UnrecoverableError;
    logger.error(
      { err: error, runId: job.data.runId, attempt: job.attemptsMade },
      'review attempt failed',
    );
    if (lastAttempt) void processor.fail(job.data.runId, error);
  });
  worker.on('error', (error) => {
    logger.error({ err: error }, 'worker error');
  });
  return {
    worker,
    // Lets running reviews finish; their locks would otherwise expire and they would be retried.
    close: async () => {
      await worker.close();
      await queue.close();
    },
  };
}
