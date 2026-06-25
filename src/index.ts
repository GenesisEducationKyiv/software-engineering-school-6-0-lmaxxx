import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runner as migrate } from 'node-pg-migrate';
import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './infra/db/pool.js';
import { redisClient } from './infra/cache/redis.js';
import { connectBus } from './infra/messaging/index.js';
import { startGrpcServer } from './interfaces/grpc.js';
import { startRepoVerificationServer } from './interfaces/repo-verification.server.js';
import {
  createGitHubRepositoryChecker,
  createGrpcRepositoryChecker,
  createGitHubReleaseFetcher,
} from './modules/github/index.js';
import { createSubscriptionService } from './modules/subscription/index.js';
import { createReleaseScanService, createRepositoryRegistrar, startScanner } from './modules/repository/index.js';
import {
  startNotificationConsumer,
  createNotificationHandlers,
  createNodemailerMailer,
  createSubscriberDirectory,
} from './modules/notification/index.js';
import { createSagaOrchestrator, recoverPendingSagas } from './infra/saga/index.js';
import { getDefinition, registerDefinition } from './modules/sagas/registry.js';
import { createCreateSubscriptionSaga } from './modules/sagas/index.js';
import { createSagaReplier } from './modules/sagas/saga-replier.js';
import { startOutboxPublisher } from './infra/messaging/outbox-publisher.js';

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

  // RepoVerificationService gRPC server wraps the GitHub REST checker; start it
  // up front so the gRPC client adapter has something to dial.
  const repoVerificationServer = await startRepoVerificationServer(config.repoVerificationGrpcPort);

  const repoChecker =
    config.repoChecker === 'grpc'
      ? createGrpcRepositoryChecker(`localhost:${config.repoVerificationGrpcPort}`)
      : createGitHubRepositoryChecker();
  console.log(`Repo verification transport: ${config.repoChecker}`);

  const releaseFetcher = createGitHubReleaseFetcher();

  const repoRegistrar = createRepositoryRegistrar();

  const subscriptionService = createSubscriptionService({ repoChecker, registrar: repoRegistrar, bus });
  const releaseScanService = createReleaseScanService({ releases: releaseFetcher, bus });

  registerDefinition(createCreateSubscriptionSaga(subscriptionService));

  const sagaOrchestrator = createSagaOrchestrator(true);
  await recoverPendingSagas(sagaOrchestrator, getDefinition);

  const sagaReplier = createSagaReplier(sagaOrchestrator);

  const handlers = createNotificationHandlers({
    subscribers: createSubscriberDirectory(),
    mailer: createNodemailerMailer(),
    bus,
    sagaReplier,
  });
  await startNotificationConsumer(bus, handlers);

  const outboxInterval = startOutboxPublisher(bus);

  const server = createApp(subscriptionService, sagaOrchestrator).listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  const scannerInterval = startScanner(releaseScanService);

  const grpcServer = await startGrpcServer(config.grpcPort, subscriptionService);

  function shutdown(signal: string) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    clearInterval(scannerInterval);
    clearInterval(outboxInterval);
    grpcServer?.forceShutdown();
    repoVerificationServer?.forceShutdown();

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
