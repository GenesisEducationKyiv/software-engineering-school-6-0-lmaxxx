import { pool } from './pool.js';
import type { Repository } from '../types.js';

export async function upsertRepository(repo: string): Promise<void> {
  await pool.query(
    'INSERT INTO repositories (repo) VALUES ($1) ON CONFLICT (repo) DO NOTHING',
    [repo],
  );
}

export async function getReposWithConfirmedSubscriptions(): Promise<Repository[]> {
  const result = await pool.query<Repository>(
    `SELECT r.* FROM repositories r
     WHERE EXISTS (
       SELECT 1 FROM subscriptions s
       WHERE s.repo = r.repo AND s.confirmed = true
     )`,
  );
  return result.rows;
}

export async function updateLastSeenTag(id: number, tag: string): Promise<void> {
  await pool.query(
    'UPDATE repositories SET last_seen_tag = $1, last_checked_at = NOW() WHERE id = $2',
    [tag, id],
  );
}
