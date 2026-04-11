import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runner as migrate } from 'node-pg-migrate';
import { config } from './config.js';

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

  console.log('Migrations applied. Server ready.');
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
