import { getReposWithConfirmedSubscriptions, updateLastSeenTag } from '../db/repositories.js';
import { getConfirmedSubscribers } from '../db/subscriptions.js';
import { getLatestRelease } from '../services/github.js';
import { sendReleaseNotification } from '../services/email.js';
import { config } from '../config.js';
import { AppError } from '../shared/appError.js';

export function startScanner(): NodeJS.Timeout {
  const run = async () => {
    const repos = await getReposWithConfirmedSubscriptions();
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
          console.warn('GitHub rate limit hit during scan, skipping remaining repos');
          break;
        }
        console.error(`Error scanning ${repo.repo}:`, err);
      }
    }
  };

  const interval = setInterval(() => {
    run().catch((err) => console.error('Scanner cycle failed:', err));
  }, config.scanIntervalMs);

  console.log(`Scanner started (interval: ${config.scanIntervalMs}ms)`);
  return interval;
}
