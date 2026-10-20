export type DeliveryStatus = 'received' | 'processed' | 'ignored' | 'failed';

export interface DeliveryRecord {
  /** `X-GitHub-Delivery`: the same value is sent again when GitHub redelivers. */
  id: string;
  event: string;
  action: string | null;
  installationId: number | null;
  repositoryId: number | null;
  payload: unknown;
  receivedAt: Date;
}

/** Raw webhook deliveries, kept 7 days to investigate or replay an incident (MongoDB). */
export interface DeliveryStore {
  /**
   * Records a delivery. Returns false when the same delivery was already handled; a delivery that
   * failed before is handled again, which is what a redelivery is for.
   */
  begin(delivery: DeliveryRecord): Promise<boolean>;
  finish(id: string, status: 'processed' | 'ignored'): Promise<void>;
  fail(id: string, error: string): Promise<void>;
}
