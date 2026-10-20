import { createApp } from './app.js';
import { loadApiConfig } from './config.js';
import { buildApiDeps } from './container.js';
import { createLogger } from './lib/logger.js';

const config = loadApiConfig();
const logger = createLogger(config.LOG_LEVEL, 'codelens-api');
const { deps, close } = await buildApiDeps(config, logger);

const server = createApp(deps).listen(config.PORT, config.HOST, () => {
  logger.info({ port: config.PORT }, 'API listening');
});
// Behind a load balancer: idle connections must outlive its own keep-alive timeout.
server.keepAliveTimeout = 65_000;

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void close().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
