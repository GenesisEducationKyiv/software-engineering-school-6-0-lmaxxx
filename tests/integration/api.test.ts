import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../src/modules/subscription/subscription.repository.js');
vi.mock('../../src/modules/repository/repository.repository.js');

import { createApp } from '../../src/app.js';
import { createSubscriptionService } from '../../src/modules/subscription/subscription.service.js';
import {
  findByEmailAndRepo,
  findByConfirmToken,
  findByUnsubscribeToken,
  save,
  deleteSubscription,
  findConfirmedByEmail,
} from '../../src/modules/subscription/subscription.repository.js';
import { upsertRepository } from '../../src/modules/repository/repository.repository.js';
import { RoutingKeys } from '../../src/shared/events.js';
import { AppError } from '../../src/shared/appError.js';
import {
  subscriptionFromRow,
  type SubscriptionRow,
} from '../../src/modules/subscription/domain/subscription.js';
import type { RepositoryChecker } from '../../src/modules/subscription/ports/repository-checker.js';
import type { EventBus } from '../../src/infra/messaging/index.js';
import type { SubscriptionResponse } from '../../src/types.js';

const VALID_UUID = '00000000-0000-0000-0000-000000000000';

const makeSub = (overrides: Partial<SubscriptionRow> = {}) =>
  subscriptionFromRow({
    id: 1,
    email: 'test@example.com',
    repo: 'owner/repo',
    confirmed: false,
    confirm_token: VALID_UUID,
    unsubscribe_token: VALID_UUID,
    created_at: new Date('2024-01-01'),
    ...overrides,
  });

let ensureExists: ReturnType<typeof vi.fn>;
let publish: ReturnType<typeof vi.fn>;
let app: Express;

beforeEach(() => {
  vi.clearAllMocks();
  ensureExists = vi.fn().mockResolvedValue(undefined);
  publish = vi.fn().mockResolvedValue(undefined);
  const service = createSubscriptionService({
    repoChecker: { ensureExists } as unknown as RepositoryChecker,
    bus: { publish } as unknown as EventBus,
  });
  app = createApp(service);
});

describe('POST /api/subscribe', () => {
  it('returns 200 and sends a confirmation email for a new subscription', async () => {
    vi.mocked(findByEmailAndRepo).mockResolvedValue(null);
    vi.mocked(save).mockResolvedValue(undefined);
    vi.mocked(upsertRepository).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Confirmation email sent' });
    expect(publish).toHaveBeenCalledWith(
      RoutingKeys.SubscriptionCreated,
      expect.objectContaining({ email: 'test@example.com', repo: 'owner/repo' }),
    );
  });

  it('returns 200 and resends confirmation for an existing unconfirmed subscription', async () => {
    vi.mocked(findByEmailAndRepo).mockResolvedValue(makeSub({ confirmed: false }));
    vi.mocked(save).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/repo' });

    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/subscribe').send({ repo: 'owner/repo' });
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
    const res = await request(app).post('/api/subscribe').send({ email: 'test@example.com' });
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
    ensureExists.mockRejectedValue(new AppError(404, 'Repository not found'));

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/nonexistent' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Repository not found' });
  });

  it('returns 409 when the subscription is already confirmed', async () => {
    vi.mocked(findByEmailAndRepo).mockResolvedValue(makeSub({ confirmed: true }));

    const res = await request(app)
      .post('/api/subscribe')
      .send({ email: 'test@example.com', repo: 'owner/repo' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Already subscribed to this repository' });
  });

  it('returns 429 when GitHub rate limit is hit', async () => {
    ensureExists.mockRejectedValue(new AppError(429, 'GitHub rate limit exceeded'));

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
    vi.mocked(save).mockResolvedValue(undefined);

    const res = await request(app).get('/api/confirm/some-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Subscription confirmed' });
    expect(save).toHaveBeenCalledOnce();
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

    const res = await request(app).get(`/api/unsubscribe/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Unsubscribed successfully' });
    expect(deleteSubscription).toHaveBeenCalledWith(1);
  });

  it('returns 400 for a malformed (non-UUID) token', async () => {
    const res = await request(app).get('/api/unsubscribe/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('returns 404 when the token is not found', async () => {
    vi.mocked(findByUnsubscribeToken).mockResolvedValue(null);

    const res = await request(app).get(`/api/unsubscribe/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Token not found' });
  });
});

const makeSubResponse = (overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse => ({
  email: 'test@example.com',
  repo: 'owner/repo',
  confirmed: true,
  last_seen_tag: null,
  ...overrides,
});

describe('GET /api/subscriptions', () => {
  it('returns 200 with confirmed subscriptions for the given email', async () => {
    vi.mocked(findConfirmedByEmail).mockResolvedValue([
      makeSubResponse(),
      makeSubResponse({ repo: 'owner/other' }),
    ]);

    const res = await request(app).get('/api/subscriptions?email=test@example.com');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns 200 with an empty array when there are no subscriptions', async () => {
    vi.mocked(findConfirmedByEmail).mockResolvedValue([] as SubscriptionResponse[]);

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
