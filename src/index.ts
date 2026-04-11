import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runner as migrate } from 'node-pg-migrate';
import { config } from './config.js';
import { app } from './app.js';
import { startScanner } from './scanner/index.js';

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

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  startScanner();
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
