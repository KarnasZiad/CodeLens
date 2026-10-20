import type { ReportStore, ReviewReport } from '../modules/reviews/report-store.js';
import type { ReviewQueue } from '../modules/reviews/review-queue.js';
import type {
  DeliveryRecord,
  DeliveryStatus,
  DeliveryStore,
} from '../modules/webhooks/delivery-store.js';

export class MemoryDeliveryStore implements DeliveryStore {
  readonly deliveries = new Map<
    string,
    DeliveryRecord & { status: DeliveryStatus; error?: string }
  >();

  begin(delivery: DeliveryRecord): Promise<boolean> {
    const known = this.deliveries.get(delivery.id);
    if (known && known.status !== 'failed') return Promise.resolve(false);
    this.deliveries.set(delivery.id, { ...delivery, status: 'received' });
    return Promise.resolve(true);
  }

  finish(id: string, status: 'processed' | 'ignored'): Promise<void> {
    const delivery = this.deliveries.get(id);
    if (delivery) delivery.status = status;
    return Promise.resolve();
  }

  fail(id: string, error: string): Promise<void> {
    const delivery = this.deliveries.get(id);
    if (delivery) Object.assign(delivery, { status: 'failed', error });
    return Promise.resolve();
  }
}

export class MemoryReportStore implements ReportStore {
  readonly reports = new Map<string, ReviewReport>();

  save(report: ReviewReport): Promise<void> {
    this.reports.set(report.runId, report);
    return Promise.resolve();
  }

  find(runId: string): Promise<ReviewReport | null> {
    return Promise.resolve(this.reports.get(runId) ?? null);
  }
}

/** Records enqueued runs, deduplicated like BullMQ does with job identifiers. */
export class MemoryQueue implements ReviewQueue {
  readonly enqueued: string[] = [];
  failure: Error | null = null;

  enqueue(runId: string): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.enqueued.includes(runId)) this.enqueued.push(runId);
    return Promise.resolve();
  }
}
