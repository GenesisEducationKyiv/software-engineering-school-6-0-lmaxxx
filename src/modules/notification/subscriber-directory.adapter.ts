import { getConfirmedSubscribers } from '../subscription/index.js';
import type { SubscriberDirectory } from './ports/subscriber-directory.js';

export function createSubscriberDirectory(): SubscriberDirectory {
  return {
    confirmedSubscribers(repo) {
      return getConfirmedSubscribers(repo);
    },
  };
}
