import { getLatestRelease } from './github.service.js';
import { ReleaseTag } from '../repository/domain/release-tag.js';
import { parseOrThrow } from '../../shared/domain/parse.js';
import type { ReleaseFetcher } from '../repository/ports/release-fetcher.js';

/** Anti-corruption adapter: ReleaseFetcher over the GitHub API; the DTO stops here. */
export function createGitHubReleaseFetcher(): ReleaseFetcher {
  return {
    async fetchLatestTag(repo) {
      const latest = await getLatestRelease(repo);
      return latest ? parseOrThrow(ReleaseTag, latest.tag_name) : null;
    },
  };
}
