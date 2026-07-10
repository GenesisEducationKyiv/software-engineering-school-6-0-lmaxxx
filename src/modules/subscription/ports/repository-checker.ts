import type { RepoSlug } from '../../../shared/domain/repo-slug.js';

/** Verifies a repository exists. Throws AppError 404/429 on failure. */
export interface RepositoryChecker {
  ensureExists(repo: RepoSlug): Promise<void>;
}
