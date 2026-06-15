import { test, expect, type APIRequestContext } from '@playwright/test';
import pg from 'pg';

const db = new pg.Pool({ connectionString: 'postgres://app:secret@localhost:5433/github_notifier_e2e' });

// Mailhog stores recipients as { Mailbox, Domain } not a plain email string
interface MailhogMessage {
  To: { Mailbox: string; Domain: string }[];
  Content: { Body: string };
}

// Polls Mailhog until the confirmation email arrives, then extracts the token from the link.
// Polling is needed because the app sends email asynchronously after the HTTP response.
async function getConfirmTokenFromEmail(request: APIRequestContext, toEmail: string): Promise<string> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const res = await request.get('http://localhost:8025/api/v2/messages?limit=50');
    const { items } = await res.json() as { items: MailhogMessage[] };

    const email = items?.find(msg =>
      msg.To.some(to => `${to.Mailbox}@${to.Domain}` === toEmail),
    );
    // Strip quoted-printable soft line breaks before matching (nodemailer wraps long lines)
    const body = email?.Content.Body.replace(/=\r\n/g, '') ?? '';
    const match = body.match(/\/api\/confirm\/([a-zA-Z0-9-]+)/);
    if (match) return match[1];

    // Email not arrived yet — wait before retrying
    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error(`Confirmation email not received for ${toEmail} within 5s`);
}

test.afterAll(async () => {
  await db.query("DELETE FROM subscriptions WHERE email LIKE 'e2e-%'");
  await db.end();
});

test('confirm-subscription flow marks subscription as confirmed', async ({ request }) => {
  await request.post('/api/subscribe', {
    data: { email: 'e2e-confirm@example.com', repo: 'owner/repo' },
  });

  const token = await getConfirmTokenFromEmail(request, 'e2e-confirm@example.com');

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

  // unsubscribe_token is only emailed in release notifications (scanner disabled in e2e)
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
