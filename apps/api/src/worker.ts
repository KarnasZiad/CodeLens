import { loadWorkerConfig } from './config.js';
import { connect } from './container.js';
import { createLogger } from './lib/logger.js';
import { GitHubProvider } from './modules/github/github-provider.js';
import { MongoReportStore } from './modules/reviews/report-store.mongo.js';
import { startReviewWorker } from './modules/reviews/review-queue.bullmq.js';
import { ReviewProcessor } from './modules/reviews/review-processor.js';

const config = loadWorkerConfig();
const logger = createLogger(config.LOG_LEVEL, 'codelens-worker');
const connections = await connect(config);

const processor = new ReviewProcessor({
  reviews: connections.reviews,
  reports: new MongoReportStore(connections.mongo.db),
  provider: new GitHubProvider({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_PRIVATE_KEY,
    apiUrl: config.GITHUB_API_URL,
    webUrl: config.GITHUB_WEB_URL,
    logger,
  }),
  logger,
});
const reviewWorker = startReviewWorker({
  connection: connections.redis,
  processor,
  concurrency: config.WORKER_CONCURRENCY,
  logger,
});
logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker started');

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  void reviewWorker
    .close()
    .then(() => connections.close())
    .then(() => process.exit(0));
  setTimeout(() => process.exit(1), 60_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
