import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runner as migrate } from 'node-pg-migrate';
import { config } from './config.js';
import { app } from './app.js';
import { startScanner } from './scanner/index.js';
import { pool } from './db/pool.js';
import { redisClient } from './cache/redis.js';
import { startGrpcServer } from './grpc/server.js';

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

  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  const scannerInterval = startScanner();

  const grpcServer = await startGrpcServer(config.grpcPort);

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
