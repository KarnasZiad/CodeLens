export const REVIEW_QUEUE = 'reviews';

export interface ReviewJob {
  runId: string;
}

/** Hands a run over to the workers. Enqueuing the same run twice is a no-op. */
export interface ReviewQueue {
  enqueue(runId: string): Promise<void>;
}
