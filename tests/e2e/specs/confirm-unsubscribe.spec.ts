import { test, expect } from '@playwright/test';
import pg from 'pg';

const db = new pg.Pool({ connectionString: 'postgres://app:secret@localhost:5433/github_notifier_e2e' });

test.afterAll(async () => {
  await db.query("DELETE FROM subscriptions WHERE email LIKE 'e2e-%'");
  await db.end();
});

test('confirm-subscription flow marks subscription as confirmed', async ({ request }) => {
  await request.post('/api/subscribe', {
    data: { email: 'e2e-confirm@example.com', repo: 'owner/repo' },
  });

  const { rows } = await db.query<{ confirm_token: string }>(
    'SELECT confirm_token FROM subscriptions WHERE email = $1',
    ['e2e-confirm@example.com'],
  );
  const token = rows[0].confirm_token;

  const res = await request.get(`/api/confirm/${token}`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ message: 'Subscription confirmed' });

  const { rows: updated } = await db.query<{ confirmed: boolean }>(
    'SELECT confirmed FROM subscriptions WHERE email = $1',
    ['e2e-confirm@example.com'],
  );
  expect(updated[0].confirmed).toBe(true);
});

test('unsubscribe flow removes subscription', async ({ request }) => {
  await request.post('/api/subscribe', {
    data: { email: 'e2e-unsub@example.com', repo: 'owner/repo' },
  });

  const { rows } = await db.query<{ unsubscribe_token: string }>(
    'SELECT unsubscribe_token FROM subscriptions WHERE email = $1',
    ['e2e-unsub@example.com'],
  );
  const token = rows[0].unsubscribe_token;

  const res = await request.get(`/api/unsubscribe/${token}`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ message: 'Unsubscribed successfully' });

  const { rows: remaining } = await db.query(
    'SELECT * FROM subscriptions WHERE email = $1',
    ['e2e-unsub@example.com'],
  );
  expect(remaining).toHaveLength(0);
});
