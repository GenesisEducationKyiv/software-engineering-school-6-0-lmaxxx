import { getReposWithConfirmedSubscriptions, updateLastSeenTag } from '../db/repositories.js';
import { getConfirmedSubscribers } from '../db/subscriptions.js';
import { getLatestRelease } from '../services/github.js';
import { sendReleaseNotification } from '../services/email.js';
import { config } from '../config.js';
import { AppError } from '../shared/appError.js';
import { scansTotal, scanDurationSeconds, activeSubscriptionsTotal } from '../metrics.js';
import { logger } from '../logger.js';

export function startScanner(): NodeJS.Timeout {
  const run = async () => {
    const timer = scanDurationSeconds.startTimer();
    const repos = await getReposWithConfirmedSubscriptions();
    activeSubscriptionsTotal.set(repos.length);
    for (const repo of repos) {
      try {
        const latest = await getLatestRelease(repo.repo);
        if (latest && latest.tag_name !== repo.last_seen_tag) {
          await updateLastSeenTag(repo.id, latest.tag_name);
          const subscribers = await getConfirmedSubscribers(repo.repo);
          for (const sub of subscribers) {
            await sendReleaseNotification(sub.email, repo.repo, latest.tag_name, sub.unsubscribe_token);
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
    timer();
  };

  const interval = setInterval(() => {
    run().catch((err) => logger.error({ err }, 'Scanner cycle failed'));
  }, config.scanIntervalMs);

  logger.info({ intervalMs: config.scanIntervalMs }, 'Scanner started');
  return interval;
}
