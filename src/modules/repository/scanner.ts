import { findReposWithConfirmedSubscriptions, save } from './repository.repository.js';
import { applyLatestRelease } from './domain/tracked-repository.js';
import { RoutingKeys } from '../../shared/events.js';
import { config } from '../../config.js';
import { AppError } from '../../shared/appError.js';
import { scansTotal } from '../../metrics.js';
import type { ReleaseFetcher } from './ports/release-fetcher.js';
import type { EventBus } from '../../infra/messaging/index.js';

export type ReleaseScanService = {
  scanOnce(): Promise<void>;
};

export function createReleaseScanService(deps: {
  releases: ReleaseFetcher;
  bus: EventBus;
}): ReleaseScanService {
  const { releases, bus } = deps;

  return {
    async scanOnce() {
      const repos = await findReposWithConfirmedSubscriptions();
      for (const repo of repos) {
        try {
          const tag = await releases.fetchLatestTag(repo.repo);
          if (tag) {
            const updated = applyLatestRelease(repo, tag);
            if (updated) {
              await save(updated);
              await bus.publish(RoutingKeys.ReleasePublished, { repo: updated.repo, tag });
            }
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
    },
  };
}

export function startScanner(service: ReleaseScanService): NodeJS.Timeout {
  const interval = setInterval(() => {
    service.scanOnce().catch((err) => console.error('Scanner cycle failed:', err));
  }, config.scanIntervalMs);

  console.log(`Scanner started (interval: ${config.scanIntervalMs}ms)`);
  return interval;
}
