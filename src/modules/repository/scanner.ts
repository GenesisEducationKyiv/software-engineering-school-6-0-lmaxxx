import { findReposWithConfirmedSubscriptions, save } from './repository.repository.js';
import { applyLatestRelease } from './domain/tracked-repository.js';
import { RoutingKeys } from '../../shared/events.js';
import { config } from '../../config.js';
import { AppError } from '../../shared/appError.js';
import { scansTotal, scanDurationSeconds, activeSubscriptionsTotal } from '../../metrics.js';
import { logger } from '../../logger.js';
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
      const stopTimer = scanDurationSeconds.startTimer();
      const repos = await findReposWithConfirmedSubscriptions();
      activeSubscriptionsTotal.set(repos.length);
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
            logger.warn({ repo: repo.repo }, 'GitHub rate limit hit during scan, skipping remaining repos');
            break;
          }
          logger.error({ repo: repo.repo, err }, `Error scanning ${repo.repo}`);
        }
      }
      scansTotal.inc();
      stopTimer();
    },
  };
}

export function startScanner(service: ReleaseScanService): NodeJS.Timeout {
  const interval = setInterval(() => {
    service.scanOnce().catch((err) => logger.error({ err }, 'Scanner cycle failed'));
  }, config.scanIntervalMs);

  logger.info({ intervalMs: config.scanIntervalMs }, 'Scanner started');
  return interval;
}
