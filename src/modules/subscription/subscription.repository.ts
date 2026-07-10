import { pool } from '../../infra/db/pool.js';
import {
  type Subscription,
  type SubscriptionRow,
  subscriptionFromRow,
} from './domain/subscription.js';
import type { SubscriptionResponse } from './interfaces/http/dtos.js';
import type { ConfirmedSubscriber } from '../notification/ports/subscriber-directory.js';

export async function findByEmailAndRepo(
  email: string,
  repo: string,
): Promise<Subscription | null> {
  const result = await pool.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE email = $1 AND repo = $2',
    [email, repo],
  );
  const row = result.rows[0];
  return row ? subscriptionFromRow(row) : null;
}

export async function findByConfirmToken(token: string): Promise<Subscription | null> {
  const result = await pool.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE confirm_token = $1',
    [token],
  );
  const row = result.rows[0];
  return row ? subscriptionFromRow(row) : null;
}

export async function findByUnsubscribeToken(token: string): Promise<Subscription | null> {
  const result = await pool.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE unsubscribe_token = $1',
    [token],
  );
  const row = result.rows[0];
  return row ? subscriptionFromRow(row) : null;
}

export async function save(subscription: Subscription): Promise<void> {
  await pool.query(
    `INSERT INTO subscriptions (id, email, repo, confirmed, confirm_token, unsubscribe_token, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET confirmed = EXCLUDED.confirmed, confirm_token = EXCLUDED.confirm_token`,
    [
      subscription.id,
      subscription.email,
      subscription.repo,
      subscription.confirmed,
      subscription.confirmToken,
      subscription.unsubscribeToken,
      subscription.createdAt,
    ],
  );
}

export async function deleteSubscription(id: string): Promise<void> {
  await pool.query('DELETE FROM subscriptions WHERE id = $1', [id]);
}

export async function findConfirmedByEmail(email: string): Promise<SubscriptionResponse[]> {
  const result = await pool.query<SubscriptionResponse>(
    `SELECT s.email, s.repo, s.confirmed, r.last_seen_tag
     FROM subscriptions s
     LEFT JOIN repositories r ON r.repo = s.repo
     WHERE s.email = $1 AND s.confirmed = true`,
    [email],
  );
  return result.rows;
}

export async function getConfirmedSubscribers(repo: string): Promise<ConfirmedSubscriber[]> {
  const result = await pool.query<ConfirmedSubscriber>(
    'SELECT email, unsubscribe_token FROM subscriptions WHERE repo = $1 AND confirmed = true',
    [repo],
  );
  return result.rows;
}
