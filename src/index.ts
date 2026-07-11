import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runner as migrate } from 'node-pg-migrate';
import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './infra/db/pool.js';
import { redisClient } from './infra/cache/redis.js';
import { connectBus } from './infra/messaging/index.js';
import { startGrpcServer } from './infra/grpc/index.js';
import { startRepoVerificationServer } from './modules/repository/interfaces/grpc/repo-verification.server.js';
import { createSubscriptionService } from './modules/subscription/index.js';
import { buildGrpcServiceImpl } from './modules/subscription/interfaces/grpc/handlers.js';
import {
  createGitHubRepositoryChecker,
  createGrpcRepositoryChecker,
  createGitHubReleaseFetcher,
  createReleaseScanService,
  createRepositoryRegistrar,
  startScanner,
} from './modules/repository/index.js';
import {
  startNotificationConsumer,
  createNotificationHandlers,
  createNodemailerMailer,
  createSubscriberDirectory,
} from './modules/notification/index.js';
import { createSagaOrchestrator, recoverPendingSagas, startSagaTimeoutSweep } from './infra/saga/index.js';
import { getDefinition, registerDefinition } from './modules/sagas/registry.js';
import { createCreateSubscriptionSaga } from './modules/sagas/index.js';
import { createSagaReplier } from './modules/sagas/saga-replier.js';
import { startOutboxPublisher } from './infra/messaging/outbox-publisher.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  await migrate({
    direction: 'up',
    databaseUrl: config.databaseUrl,
    migrationsTable: 'pgmigrations',
    dir: join(__dirname, '..', 'migrations'),
    log: (msg: string) => logger.debug({ component: 'migration' }, msg),
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

  const sagaOrchestrator = createSagaOrchestrator();
  await recoverPendingSagas(sagaOrchestrator, getDefinition);

  const sagaReplier = createSagaReplier(sagaOrchestrator);

  const handlers = createNotificationHandlers({
    subscribers: createSubscriberDirectory(),
    mailer: createNodemailerMailer(),
    bus,
    sagaReplier,
  });
  await startNotificationConsumer(bus, handlers);

  const outbox = startOutboxPublisher(bus);

  const server = createApp(subscriptionService, sagaOrchestrator).listen(config.port, () => {
    logger.info({ port: config.port }, 'Server listening');
  });

  const scannerInterval = startScanner(releaseScanService);
  const sagaTimeoutSweep = startSagaTimeoutSweep(sagaOrchestrator, getDefinition, config.sagaTimeoutSweepIntervalMs);

  const grpcServer = await startGrpcServer(config.grpcPort, buildGrpcServiceImpl(subscriptionService));

  function shutdown(signal: string) {
    logger.info({ signal }, 'Received signal, shutting down gracefully');
    clearInterval(scannerInterval);
    outbox.stop();
    sagaTimeoutSweep.stop();
    grpcServer?.forceShutdown();
    repoVerificationServer?.forceShutdown();

    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async () => {
      await bus.close();
      await pool.end();
      await redisClient?.quit();
      logger.info('Shutdown complete');
      clearTimeout(forceExit);
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Startup failed');
  process.exit(1);
});
