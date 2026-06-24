import { pool } from '../../infra/db/pool.js';
import {
  type TrackedRepository,
  type RepositoryRow,
  trackedRepositoryFromRow,
} from './domain/tracked-repository.js';

export async function upsertRepository(repo: string): Promise<void> {
  await pool.query(
    'INSERT INTO repositories (repo) VALUES ($1) ON CONFLICT (repo) DO NOTHING',
    [repo],
  );
}

export async function findReposWithConfirmedSubscriptions(): Promise<TrackedRepository[]> {
  const result = await pool.query<RepositoryRow>(
    `SELECT r.* FROM repositories r
     WHERE EXISTS (
       SELECT 1 FROM subscriptions s
       WHERE s.repo = r.repo AND s.confirmed = true
     )`,
  );
  return result.rows.map(trackedRepositoryFromRow);
}

export async function save(repository: TrackedRepository): Promise<void> {
  await pool.query(
    'UPDATE repositories SET last_seen_tag = $1, last_checked_at = NOW() WHERE id = $2',
    [repository.lastSeenTag, repository.id],
  );
}
