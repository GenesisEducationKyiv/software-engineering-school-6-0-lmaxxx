import { checkRepoExists } from './github.service.js';
import type { RepositoryChecker } from '../subscription/ports/repository-checker.js';

/** Anti-corruption adapter: RepositoryChecker over the GitHub API. */
export function createGitHubRepositoryChecker(): RepositoryChecker {
  return {
    async ensureExists(repo) {
      await checkRepoExists(repo);
    },
  };
}
