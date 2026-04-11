import { pool } from './pool.js';

export async function upsertRepository(repo: string): Promise<void> {
  await pool.query(
    'INSERT INTO repositories (repo) VALUES ($1) ON CONFLICT (repo) DO NOTHING',
    [repo],
  );
}
