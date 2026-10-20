import { type Collection, type Db, MongoServerError } from 'mongodb';
import type { DeliveryRecord, DeliveryStore, DeliveryStatus } from './delivery-store.js';

interface DeliveryDocument extends Omit<DeliveryRecord, 'id'> {
  _id: string;
  status: DeliveryStatus;
  attempts: number;
  error?: string;
  updatedAt: Date;
}

const DUPLICATE_KEY = 11000;

export class MongoDeliveryStore implements DeliveryStore {
  private readonly deliveries: Collection<DeliveryDocument>;

  constructor(db: Db) {
    this.deliveries = db.collection<DeliveryDocument>('webhook_deliveries');
  }

  async begin({ id, ...delivery }: DeliveryRecord): Promise<boolean> {
    try {
      // The insert is the deduplication: _id is unique, so two concurrent deliveries cannot both win.
      await this.deliveries.insertOne({
        _id: id,
        ...delivery,
        status: 'received',
        attempts: 1,
        updatedAt: new Date(),
      });
      return true;
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== DUPLICATE_KEY) throw error;
    }
    // Already seen: handled again only if the previous attempt failed.
    const retried = await this.deliveries.findOneAndUpdate(
      { _id: id, status: 'failed' },
      { $set: { status: 'received', updatedAt: new Date() }, $inc: { attempts: 1 } },
    );
    return retried !== null;
  }

  async finish(id: string, status: 'processed' | 'ignored'): Promise<void> {
    await this.deliveries.updateOne(
      { _id: id },
      { $set: { status, updatedAt: new Date() }, $unset: { error: '' } },
    );
  }

  async fail(id: string, error: string): Promise<void> {
    await this.deliveries.updateOne(
      { _id: id },
      { $set: { status: 'failed', error: error.slice(0, 1000), updatedAt: new Date() } },
    );
  }
}
