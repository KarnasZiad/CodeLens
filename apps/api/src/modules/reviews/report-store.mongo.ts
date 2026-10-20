import type { Collection, Db } from 'mongodb';
import type { ReportStore, ReviewReport } from './report-store.js';

type ReportDocument = Omit<ReviewReport, 'runId'> & { _id: string };

export class MongoReportStore implements ReportStore {
  private readonly reports: Collection<ReportDocument>;

  constructor(db: Db) {
    this.reports = db.collection<ReportDocument>('review_reports');
  }

  async save({ runId, ...report }: ReviewReport): Promise<void> {
    await this.reports.replaceOne({ _id: runId }, report, { upsert: true });
  }

  async find(runId: string): Promise<ReviewReport | null> {
    const document = await this.reports.findOne({ _id: runId });
    if (!document) return null;
    const { _id, ...report } = document;
    return { runId: _id, ...report };
  }
}
