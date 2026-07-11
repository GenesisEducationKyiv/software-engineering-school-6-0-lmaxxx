import type { RepoSlug } from '../../shared/domain/repo-slug.js';
import type { ReleaseTag } from './domain/release-tag.js';
import type { TrackedRepository } from './domain/tracked-repository.js';

export interface RepositoryRow {
  id: number;
  repo: string;
  last_seen_tag: string | null;
  last_checked_at: Date | null;
}

export function trackedRepositoryFromRow(row: RepositoryRow): TrackedRepository {
  return {
    repo: row.repo as RepoSlug,
    lastSeenTag: row.last_seen_tag as ReleaseTag | null,
    lastCheckedAt: row.last_checked_at,
  };
}
