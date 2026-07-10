/** Read model: a confirmed subscriber to notify about a release. */
export interface ConfirmedSubscriber {
  email: string;
  unsubscribe_token: string;
}

/** Looks up the confirmed subscribers for a repository. */
export interface SubscriberDirectory {
  confirmedSubscribers(repo: string): Promise<ConfirmedSubscriber[]>;
}
