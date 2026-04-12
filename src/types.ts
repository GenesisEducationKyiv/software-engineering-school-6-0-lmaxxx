export interface Subscription {
  id: number;
  email: string;
  repo: string;
  confirmed: boolean;
  confirm_token: string;
  unsubscribe_token: string;
  created_at: Date;
}

export interface SubscriptionResponse {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string | null;
}

export interface Repository {
  id: number;
  repo: string;
  last_seen_tag: string | null;
  last_checked_at: Date | null;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
}
