import type { RepoSlug } from '../../../shared/domain/repo-slug.js';
import type { ReleaseTag } from './release-tag.js';

export type TrackedRepository = {
  readonly repo: RepoSlug;
  readonly lastSeenTag: ReleaseTag | null;
  readonly lastCheckedAt: Date | null;
};

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
