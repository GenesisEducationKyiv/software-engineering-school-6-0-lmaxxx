import { getReposWithConfirmedSubscriptions, updateLastSeenTag } from './repository.repository.js';
import { getLatestRelease } from '../github/index.js';
import { getBus } from '../../infra/messaging/index.js';
import { RoutingKeys } from '../../shared/events.js';
import { config } from '../../config.js';
import { AppError } from '../../shared/appError.js';
import { scansTotal } from '../../metrics.js';

export function startScanner(): NodeJS.Timeout {
  const run = async () => {
    const repos = await getReposWithConfirmedSubscriptions();
    for (const repo of repos) {
      try {
        const latest = await getLatestRelease(repo.repo);
        if (latest && latest.tag_name !== repo.last_seen_tag) {
          await updateLastSeenTag(repo.id, latest.tag_name);
          await getBus().publish(RoutingKeys.ReleasePublished, {
            repo: repo.repo,
            tag: latest.tag_name,
          });
        }
      } catch (err: unknown) {
        if (err instanceof AppError && err.status === 429) {
          console.warn('GitHub rate limit hit during scan, skipping remaining repos');
          break;
        }
        console.error(`Error scanning ${repo.repo}:`, err);
      }
    }
    scansTotal.inc();
  };

  const interval = setInterval(() => {
    run().catch((err) => console.error('Scanner cycle failed:', err));
  }, config.scanIntervalMs);

  console.log(`Scanner started (interval: ${config.scanIntervalMs}ms)`);
  return interval;
}
