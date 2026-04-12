import { pool } from './pool.js';
import type { Subscription, SubscriptionResponse } from '../types.js';

export async function findByEmailAndRepo(
  email: string,
  repo: string,
): Promise<Subscription | null> {
  const result = await pool.query<Subscription>(
    'SELECT * FROM subscriptions WHERE email = $1 AND repo = $2',
    [email, repo],
  );
  return result.rows[0] ?? null;
}

export async function insertSubscription(
  email: string,
  repo: string,
  confirmToken: string,
  unsubscribeToken: string,
): Promise<Subscription> {
  const result = await pool.query<Subscription>(
    `INSERT INTO subscriptions (email, repo, confirm_token, unsubscribe_token)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, repo, confirmToken, unsubscribeToken],
  );
  return result.rows[0]!;
}

export async function updateConfirmToken(
  id: number,
  confirmToken: string,
): Promise<void> {
  await pool.query(
    'UPDATE subscriptions SET confirm_token = $1 WHERE id = $2',
    [confirmToken, id],
  );
}

export async function findByConfirmToken(token: string): Promise<Subscription | null> {
  const result = await pool.query<Subscription>(
    'SELECT * FROM subscriptions WHERE confirm_token = $1',
    [token],
  );
  return result.rows[0] ?? null;
}

export async function markConfirmed(id: number): Promise<void> {
  await pool.query(
    'UPDATE subscriptions SET confirmed = true WHERE id = $1',
    [id],
  );
}

export async function findByUnsubscribeToken(token: string): Promise<Subscription | null> {
  const result = await pool.query<Subscription>(
    'SELECT * FROM subscriptions WHERE unsubscribe_token = $1',
    [token],
  );
  return result.rows[0] ?? null;
}

export async function deleteSubscription(id: number): Promise<void> {
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

export async function getConfirmedSubscribers(repo: string): Promise<Subscription[]> {
  const result = await pool.query<Subscription>(
    'SELECT * FROM subscriptions WHERE repo = $1 AND confirmed = true',
    [repo],
  );
  return result.rows;
}
