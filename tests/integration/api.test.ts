import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-id' }),
    }),
  },
}));

vi.mock('axios');

import { app } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import axios from 'axios';

const mockAxiosGet = vi.mocked(axios.get);
const mockIsAxiosError = vi.mocked(axios.isAxiosError);

const CONFIRM_TOKEN = '11111111-1111-1111-1111-111111111111';
const UNSUB_TOKEN = '22222222-2222-2222-2222-222222222222';

async function cleanDb() {
  await pool.query('DELETE FROM subscriptions');
  await pool.query('DELETE FROM repositories');
}

async function insertSub(opts: {
  email?: string;
  repo?: string;
  confirmed?: boolean;
  confirmToken?: string;
  unsubToken?: string;
}) {
  const {
    email = 'user@example.com',
    repo = 'owner/repo',
    confirmed = false,
    confirmToken = CONFIRM_TOKEN,
    unsubToken = UNSUB_TOKEN,
  } = opts;
  await pool.query(
    `INSERT INTO subscriptions (email, repo, confirm_token, unsubscribe_token, confirmed)
     VALUES ($1, $2, $3, $4, $5)`,
    [email, repo, confirmToken, unsubToken, confirmed],
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockAxiosGet.mockResolvedValue({ data: { full_name: 'owner/repo' }, status: 200 });
  mockIsAxiosError.mockReturnValue(false);
  await cleanDb();
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/subscribe', () => {
  it('inserts subscription + repository row and returns 200', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'user@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Confirmation email sent' });

    const { rows: subs } = await pool.query(
      'SELECT * FROM subscriptions WHERE email = $1 AND repo = $2',
      ['user@example.com', 'owner/repo'],
    );
    expect(subs).toHaveLength(1);
    expect(subs[0].confirmed).toBe(false);

    const { rows: repos } = await pool.query(
      'SELECT * FROM repositories WHERE repo = $1',
      ['owner/repo'],
    );
    expect(repos).toHaveLength(1);
  });

  it('re-subscribing when unconfirmed updates confirm_token and returns 200', async () => {
    await insertSub({ confirmToken: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'user@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT * FROM subscriptions WHERE email = $1',
      ['user@example.com'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].confirm_token).not.toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('returns 409 when subscription is already confirmed', async () => {
    await insertSub({ confirmed: true });

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'user@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(409);

    const { rows } = await pool.query('SELECT * FROM subscriptions');
    expect(rows).toHaveLength(1);
  });

  it('returns 404 when GitHub repo does not exist', async () => {
    const err = { response: { status: 404 } };
    mockAxiosGet.mockRejectedValueOnce(err);
    mockIsAxiosError.mockReturnValue(true);

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'user@example.com', repo: 'owner/notfound' });

    expect(res.status).toBe(404);

    const { rows } = await pool.query('SELECT * FROM subscriptions');
    expect(rows).toHaveLength(0);
  });

  it('returns 429 when GitHub rate limit is exceeded', async () => {
    const err = { response: { status: 429 } };
    mockAxiosGet.mockRejectedValueOnce(err);
    mockIsAxiosError.mockReturnValue(true);

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'user@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(429);
  });

  it.each([
    ['missing email', { repo: 'owner/repo' }],
    ['invalid email', { email: 'not-an-email', repo: 'owner/repo' }],
    ['missing repo', { email: 'user@example.com' }],
    ['invalid repo format', { email: 'user@example.com', repo: 'no-slash' }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await request(app).post('/api/subscribe').send(body);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/confirm/:token', () => {
  it('marks subscription confirmed and returns 200', async () => {
    await insertSub({ confirmed: false });

    const res = await request(app).get(`/api/confirm/${CONFIRM_TOKEN}`);

    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT confirmed FROM subscriptions WHERE confirm_token = $1',
      [CONFIRM_TOKEN],
    );
    expect(rows[0].confirmed).toBe(true);
  });

  it('returns 400 when already confirmed', async () => {
    await insertSub({ confirmed: true });

    const res = await request(app).get(`/api/confirm/${CONFIRM_TOKEN}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(app).get('/api/confirm/nonexistent-token');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/unsubscribe/:token', () => {
  it('deletes subscription and returns 200', async () => {
    await insertSub({});

    const res = await request(app).get(`/api/unsubscribe/${UNSUB_TOKEN}`);

    expect(res.status).toBe(200);

    const { rows } = await pool.query('SELECT * FROM subscriptions');
    expect(rows).toHaveLength(0);
  });

  it('returns 400 for malformed (non-UUID) token', async () => {
    const res = await request(app).get('/api/unsubscribe/not-a-uuid');

    expect(res.status).toBe(400);
  });

  it('returns 404 for valid UUID that does not exist', async () => {
    const res = await request(app).get('/api/unsubscribe/33333333-3333-3333-3333-333333333333');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/subscriptions', () => {
  it('returns only confirmed subscriptions for the email', async () => {
    await insertSub({
      confirmed: true,
      repo: 'owner/repo-one',
      unsubToken: '44444444-4444-4444-4444-444444444444',
      confirmToken: '55555555-5555-5555-5555-555555555555',
    });
    await insertSub({
      confirmed: false,
      repo: 'owner/repo-two',
      unsubToken: '66666666-6666-6666-6666-666666666666',
      confirmToken: '77777777-7777-7777-7777-777777777777',
    });

    const res = await request(app)
      .get('/api/subscriptions')
      .query({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].repo).toBe('owner/repo-one');
  });

  it('returns empty array when no confirmed subscriptions exist', async () => {
    const res = await request(app)
      .get('/api/subscriptions')
      .query({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('includes last_seen_tag from repositories table when present', async () => {
    await insertSub({ confirmed: true });
    await pool.query(
      "INSERT INTO repositories (repo, last_seen_tag) VALUES ('owner/repo', 'v2.0.0')",
    );

    const res = await request(app)
      .get('/api/subscriptions')
      .query({ email: 'user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body[0].last_seen_tag).toBe('v2.0.0');
  });

  it('returns 400 when email query param is missing', async () => {
    const res = await request(app).get('/api/subscriptions');

    expect(res.status).toBe(400);
  });
});
