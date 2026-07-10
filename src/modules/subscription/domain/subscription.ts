import { randomUUID } from 'node:crypto';
import { AppError } from '../../../shared/appError.js';
import { parseOrThrow } from '../../../shared/domain/parse.js';
import { Email } from '../../../shared/domain/email.js';
import { RepoSlug } from '../../../shared/domain/repo-slug.js';
import { Token, generateToken } from './token.js';

export type Subscription = {
  readonly id: string;
  readonly email: Email;
  readonly repo: RepoSlug;
  readonly confirmed: boolean;
  readonly confirmToken: Token | null;
  readonly unsubscribeToken: Token;
  readonly createdAt: Date;
};

export interface SubscriptionRow {
  id: string;
  email: string;
  repo: string;
  confirmed: boolean;
  confirm_token: string | null;
  unsubscribe_token: string;
  created_at: Date;
}

export function createSubscription(email: Email, repo: RepoSlug): Subscription {
  return {
    id: randomUUID(),
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
    email: parseOrThrow(Email, row.email, 500),
    repo: parseOrThrow(RepoSlug, row.repo, 500),
    confirmed: row.confirmed,
    confirmToken:
      row.confirm_token === null ? null : parseOrThrow(Token, row.confirm_token, 500),
    unsubscribeToken: parseOrThrow(Token, row.unsubscribe_token, 500),
    createdAt: row.created_at,
  };
}
