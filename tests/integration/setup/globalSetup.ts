import pg from 'pg';
import { runner as migrate } from 'node-pg-migrate';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const COMPOSE_FILE = 'docker-compose.integration.yml';
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://testuser:testpass@localhost:5433/github_notifier_test';

export async function setup() {
  execSync(`docker compose -f ${COMPOSE_FILE} up -d --wait`, { stdio: 'inherit' });

  await migrate({
    direction: 'up',
    databaseUrl: DATABASE_URL,
    migrationsTable: 'pgmigrations',
    dir: MIGRATIONS_DIR,
    log: () => {},
  });
}

export async function teardown() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  await pool.query('DROP TABLE IF EXISTS subscriptions, repositories, pgmigrations CASCADE');
  await pool.end();

  execSync(`docker compose -f ${COMPOSE_FILE} down`, { stdio: 'inherit' });
}
