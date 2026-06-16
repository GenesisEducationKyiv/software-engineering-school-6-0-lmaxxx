import { AppError } from '../../../shared/appError.js';
import type { Email } from '../../../shared/domain/email.js';
import type { RepoSlug } from '../../../shared/domain/repo-slug.js';
import { type Token, generateToken } from './token.js';

export type Subscription = {
  readonly id: number | null;
  readonly email: Email;
  readonly repo: RepoSlug;
  readonly confirmed: boolean;
  readonly confirmToken: Token | null;
  readonly unsubscribeToken: Token;
  readonly createdAt: Date;
};

export interface SubscriptionRow {
  id: number;
  email: string;
  repo: string;
  confirmed: boolean;
  confirm_token: string | null;
  unsubscribe_token: string;
  created_at: Date;
}

export function createSubscription(email: Email, repo: RepoSlug): Subscription {
  return {
    id: null,
    email,
    repo,
    confirmed: false,
    confirmToken: generateToken(),
    unsubscribeToken: generateToken(),
    createdAt: new Date(),
  };
}

export function reissueConfirmation(sub: Subscription): Subscription {
  if (sub.confirmed) {
    throw new AppError(409, 'Already subscribed to this repository');
  }
  return { ...sub, confirmToken: generateToken() };
}

export function confirm(sub: Subscription): Subscription {
  if (sub.confirmed) {
    throw new AppError(400, 'Subscription already confirmed');
  }
  return { ...sub, confirmed: true, confirmToken: null };
}

export function subscriptionFromRow(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    email: row.email as Email,
    repo: row.repo as RepoSlug,
    confirmed: row.confirmed,
    confirmToken: row.confirm_token as Token | null,
    unsubscribeToken: row.unsubscribe_token as Token,
    createdAt: row.created_at,
  };
}
