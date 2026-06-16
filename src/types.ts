export interface SubscriptionResponse {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string | null;
}

/** Read model: a confirmed subscriber to notify about a release. */
export interface ConfirmedSubscriber {
  email: string;
  unsubscribe_token: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
}
