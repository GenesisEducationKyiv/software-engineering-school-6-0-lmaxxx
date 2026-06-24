import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runner as migrate } from 'node-pg-migrate';
import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './infra/db/pool.js';
import { redisClient } from './infra/cache/redis.js';
import { connectBus } from './infra/messaging/index.js';
import { startGrpcServer } from './interfaces/grpc.js';
import { createGitHubRepositoryChecker, createGitHubReleaseFetcher } from './modules/github/index.js';
import { createSubscriptionService } from './modules/subscription/index.js';
import { createReleaseScanService, createRepositoryRegistrar, startScanner } from './modules/repository/index.js';
import {
  startNotificationConsumer,
  createNotificationHandlers,
  createNodemailerMailer,
  createSubscriberDirectory,
} from './modules/notification/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  await migrate({
    direction: 'up',
    databaseUrl: config.databaseUrl,
    migrationsTable: 'pgmigrations',
    dir: join(__dirname, '..', 'migrations'),
    log: console.log,
  });

  const bus = await connectBus();

  const repoChecker = createGitHubRepositoryChecker();
  const releaseFetcher = createGitHubReleaseFetcher();

  const repoRegistrar = createRepositoryRegistrar();

  const subscriptionService = createSubscriptionService({ repoChecker, registrar: repoRegistrar, bus });
  const releaseScanService = createReleaseScanService({ releases: releaseFetcher, bus });

  const handlers = createNotificationHandlers({
    subscribers: createSubscriberDirectory(),
    mailer: createNodemailerMailer(),
    bus,
  });
  await startNotificationConsumer(bus, handlers);

  const server = createApp(subscriptionService).listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  const scannerInterval = startScanner(releaseScanService);

  const grpcServer = await startGrpcServer(config.grpcPort, subscriptionService);

  function shutdown(signal: string) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    clearInterval(scannerInterval);
    grpcServer?.forceShutdown();

    const forceExit = setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async () => {
      await bus.close();
      await pool.end();
      await redisClient?.quit();
      console.log('Shutdown complete');
      clearTimeout(forceExit);
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
