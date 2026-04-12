import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../src/db/subscriptions.js');
vi.mock('../../src/db/repositories.js');
vi.mock('../../src/services/github.js');
vi.mock('../../src/services/email.js');

import { app } from '../../src/app.js';
import {
  findByEmailAndRepo,
  insertSubscription,
  updateConfirmToken,
  findByConfirmToken,
  markConfirmed,
  findByUnsubscribeToken,
  deleteSubscription,
  findConfirmedByEmail,
} from '../../src/db/subscriptions.js';
import { upsertRepository } from '../../src/db/repositories.js';
import { checkRepoExists } from '../../src/services/github.js';
import { sendConfirmationEmail } from '../../src/services/email.js';
import { AppError } from '../../src/shared/appError.js';
import type { Subscription } from '../../src/types.js';

const makeSub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 1,
  email: 'test@example.com',
  repo: 'owner/repo',
  confirmed: false,
  confirm_token: 'confirm-token-uuid',
  unsubscribe_token: 'unsub-token-uuid',
  created_at: new Date('2024-01-01'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/subscribe', () => {
  it('returns 200 and sends a confirmation email for a new subscription', async () => {
    vi.mocked(checkRepoExists).mockResolvedValue(undefined);
    vi.mocked(findByEmailAndRepo).mockResolvedValue(null);
    vi.mocked(insertSubscription).mockResolvedValue(makeSub());
    vi.mocked(upsertRepository).mockResolvedValue(undefined);
    vi.mocked(sendConfirmationEmail).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Confirmation email sent' });
    expect(sendConfirmationEmail).toHaveBeenCalledOnce();
  });

  it('returns 200 and resends confirmation for an existing unconfirmed subscription', async () => {
    vi.mocked(checkRepoExists).mockResolvedValue(undefined);
    vi.mocked(findByEmailAndRepo).mockResolvedValue(makeSub({ confirmed: false }));
    vi.mocked(updateConfirmToken).mockResolvedValue(undefined);
    vi.mocked(sendConfirmationEmail).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(200);
    expect(updateConfirmToken).toHaveBeenCalledOnce();
    expect(sendConfirmationEmail).toHaveBeenCalledOnce();
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({ repo: 'owner/repo' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'email is required' });
  });

  it('returns 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'not-an-email', repo: 'owner/repo' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid email format' });
  });

  it('returns 400 when repo is missing', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'repo is required' });
  });

  it('returns 400 when repo format is invalid', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'invalid-no-slash' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('Invalid repo format') });
  });

  it('returns 404 when the repo does not exist on GitHub', async () => {
    vi.mocked(checkRepoExists).mockRejectedValue(new AppError(404, 'Repository not found'));

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/nonexistent' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Repository not found' });
  });

  it('returns 409 when the subscription is already confirmed', async () => {
    vi.mocked(checkRepoExists).mockResolvedValue(undefined);
    vi.mocked(findByEmailAndRepo).mockResolvedValue(makeSub({ confirmed: true }));

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Already subscribed to this repository' });
  });

  it('returns 429 when GitHub rate limit is hit', async () => {
    vi.mocked(checkRepoExists).mockRejectedValue(new AppError(429, 'GitHub rate limit exceeded'));

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'GitHub rate limit exceeded' });
  });
});

describe('GET /api/confirm/:token', () => {
  it('returns 200 for a valid unconfirmed token', async () => {
    vi.mocked(findByConfirmToken).mockResolvedValue(makeSub({ confirmed: false }));
    vi.mocked(markConfirmed).mockResolvedValue(undefined);

    const res = await request(app).get('/api/confirm/some-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Subscription confirmed' });
    expect(markConfirmed).toHaveBeenCalledWith(1);
  });

  it('returns 400 when the subscription is already confirmed', async () => {
    vi.mocked(findByConfirmToken).mockResolvedValue(makeSub({ confirmed: true }));

    const res = await request(app).get('/api/confirm/some-token');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Subscription already confirmed' });
  });

  it('returns 404 when the token is not found', async () => {
    vi.mocked(findByConfirmToken).mockResolvedValue(null);

    const res = await request(app).get('/api/confirm/nonexistent-token');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Confirmation token not found' });
  });
});

describe('GET /api/unsubscribe/:token', () => {
  it('returns 200 and deletes the subscription for a valid token', async () => {
    vi.mocked(findByUnsubscribeToken).mockResolvedValue(makeSub());
    vi.mocked(deleteSubscription).mockResolvedValue(undefined);

    const res = await request(app).get('/api/unsubscribe/some-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Unsubscribed successfully' });
    expect(deleteSubscription).toHaveBeenCalledWith(1);
  });

  it('returns 404 when the token is not found', async () => {
    vi.mocked(findByUnsubscribeToken).mockResolvedValue(null);

    const res = await request(app).get('/api/unsubscribe/nonexistent-token');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Subscription not found' });
  });
});

describe('GET /api/subscriptions', () => {
  it('returns 200 with confirmed subscriptions for the given email', async () => {
    const subs = [
      makeSub({ confirmed: true }),
      makeSub({ id: 2, repo: 'owner/other', confirmed: true }),
    ];
    vi.mocked(findConfirmedByEmail).mockResolvedValue(subs);

    const res = await request(app).get('/api/subscriptions?email=test@example.com');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns 200 with an empty array when there are no subscriptions', async () => {
    vi.mocked(findConfirmedByEmail).mockResolvedValue([]);

    const res = await request(app).get('/api/subscriptions?email=test@example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 400 when the email query param is missing', async () => {
    const res = await request(app).get('/api/subscriptions');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('email') });
  });

  it('returns 400 when the email format is invalid', async () => {
    const res = await request(app).get('/api/subscriptions?email=not-valid');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid email format' });
  });
});
