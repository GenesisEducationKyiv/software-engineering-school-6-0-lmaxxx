import { pool } from '../../infra/db/pool.js';
import {
  type Subscription,
  type SubscriptionRow,
  subscriptionFromRow,
} from './domain/subscription.js';
import type { SubscriptionResponse, ConfirmedSubscriber } from '../../types.js';

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

type SaveResult = number | undefined;

export async function save(subscription: Subscription): Promise<SaveResult> {
  if (subscription.id === null) {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO subscriptions (email, repo, confirm_token, unsubscribe_token)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        subscription.email,
        subscription.repo,
        subscription.confirmToken,
        subscription.unsubscribeToken,
      ],
    );
    return result.rows[0].id;
  }

  await pool.query(
    'UPDATE subscriptions SET confirmed = $1, confirm_token = $2 WHERE id = $3',
    [subscription.confirmed, subscription.confirmToken, subscription.id],
  );
  return;
}

export async function deleteSubscription(id: number): Promise<void> {
  await pool.query('DELETE FROM subscriptions WHERE id = $1', [id]);
}

export async function findById(id: number): Promise<Subscription | null> {
  const result = await pool.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  return row ? subscriptionFromRow(row) : null;
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
