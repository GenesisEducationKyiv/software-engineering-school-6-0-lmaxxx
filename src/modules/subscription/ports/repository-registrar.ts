import type { RepoSlug } from '../../../shared/domain/repo-slug.js';

export interface RepositoryRegistrar {
  ensureTracked(repo: RepoSlug): Promise<void>;
}
