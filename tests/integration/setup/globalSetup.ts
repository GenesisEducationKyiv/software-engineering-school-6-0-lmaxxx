import pg from 'pg';
import { runner as migrate } from 'node-pg-migrate';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

export async function setup() {
  await migrate({
    direction: 'up',
    databaseUrl: process.env['DATABASE_URL']!,
    migrationsTable: 'pgmigrations',
    dir: MIGRATIONS_DIR,
    log: () => {},
  });
}

export async function teardown() {
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL']! });
  await pool.query('DROP TABLE IF EXISTS subscriptions, repositories, pgmigrations CASCADE');
  await pool.end();
}
