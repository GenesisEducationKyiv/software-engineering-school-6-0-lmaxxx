import type { RepoSlug } from '../../../shared/domain/repo-slug.js';
import type { ReleaseTag } from './release-tag.js';

export type TrackedRepository = {
  readonly id: number;
  readonly repo: RepoSlug;
  readonly lastSeenTag: ReleaseTag | null;
  readonly lastCheckedAt: Date | null;
};

export interface RepositoryRow {
  id: number;
  repo: string;
  last_seen_tag: string | null;
  last_checked_at: Date | null;
}

export function trackedRepositoryFromRow(row: RepositoryRow): TrackedRepository {
  return {
    id: row.id,
    repo: row.repo as RepoSlug,
    lastSeenTag: row.last_seen_tag as ReleaseTag | null,
    lastCheckedAt: row.last_checked_at,
  };
}

/** Returns the updated repository when `tag` is new, or null when unchanged. */
export function applyLatestRelease(
  repo: TrackedRepository,
  tag: ReleaseTag,
): TrackedRepository | null {
  if (repo.lastSeenTag === tag) {
    return null;
  }
  return { ...repo, lastSeenTag: tag, lastCheckedAt: new Date() };
}
