import type { ConfirmedSubscriber } from '../../../types.js';

/** Looks up the confirmed subscribers for a repository. */
export interface SubscriberDirectory {
  confirmedSubscribers(repo: string): Promise<ConfirmedSubscriber[]>;
}
