import type { RepoSlug } from '../../../shared/domain/repo-slug.js';
import type { ReleaseTag } from '../domain/release-tag.js';

/** Fetches the latest release tag, or null when the repo has no releases. */
export interface ReleaseFetcher {
  fetchLatestTag(repo: RepoSlug): Promise<ReleaseTag | null>;
}
