import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSubscriptionService,
  validateRepoFormat,
  type SubscriptionService,
} from '../../src/modules/subscription/subscription.service.js';
import { RoutingKeys } from '../../src/shared/events.js';
import {
  subscriptionFromRow,
  type SubscriptionRow,
  type Subscription,
} from '../../src/modules/subscription/domain/subscription.js';
import type { RepositoryChecker } from '../../src/modules/subscription/ports/repository-checker.js';
import type { EventBus } from '../../src/infra/messaging/index.js';

vi.mock('../../src/modules/subscription/subscription.repository.js', () => ({
  findByEmailAndRepo: vi.fn(),
  findByConfirmToken: vi.fn(),
  findByUnsubscribeToken: vi.fn(),
  save: vi.fn(),
  deleteSubscription: vi.fn(),
  findConfirmedByEmail: vi.fn(),
  getConfirmedSubscribers: vi.fn(),
}));

import {
  findByEmailAndRepo,
  findByConfirmToken,
  findByUnsubscribeToken,
  save,
  deleteSubscription,
} from '../../src/modules/subscription/subscription.repository.js';

const mockFindByEmailAndRepo = vi.mocked(findByEmailAndRepo);
const mockFindByConfirmToken = vi.mocked(findByConfirmToken);
const mockFindByUnsubscribeToken = vi.mocked(findByUnsubscribeToken);
const mockSave = vi.mocked(save);
const mockDeleteSubscription = vi.mocked(deleteSubscription);

const VALID_UUID = '00000000-0000-0000-0000-000000000000';

function makeAggregate(overrides: Partial<SubscriptionRow> = {}): Subscription {
  return subscriptionFromRow({
    id: 1,
    email: 'user@example.com',
    repo: 'owner/repo',
    confirmed: false,
    confirm_token: VALID_UUID,
    unsubscribe_token: VALID_UUID,
    created_at: new Date(),
    ...overrides,
  });
}

let ensureExists: ReturnType<typeof vi.fn>;
let publish: ReturnType<typeof vi.fn>;
let service: SubscriptionService;

beforeEach(() => {
  vi.clearAllMocks();
  ensureExists = vi.fn().mockResolvedValue(undefined);
  publish = vi.fn().mockResolvedValue(undefined);
  service = createSubscriptionService({
    repoChecker: { ensureExists } as unknown as RepositoryChecker,
    bus: { publish } as unknown as EventBus,
  });
});

describe('validateRepoFormat', () => {
  it('accepts valid owner/repo', () => {
    expect(validateRepoFormat('golang/go')).toBe(true);
  });

  it('rejects missing slash and multiple slashes', () => {
    expect(validateRepoFormat('invalid')).toBe(false);
    expect(validateRepoFormat('a/b/c')).toBe(false);
  });
});

describe('subscribe', () => {
  it('creates a new subscription, persists it, and publishes the created event', async () => {
    mockFindByEmailAndRepo.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);

    await service.subscribe('user@example.com', 'owner/repo');

    expect(ensureExists).toHaveBeenCalledOnce();
    expect(ensureExists.mock.calls[0][0]).toBe('owner/repo');
    expect(mockSave).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(
      RoutingKeys.SubscriptionCreated,
      expect.objectContaining({
        email: 'user@example.com',
        repo: 'owner/repo',
        confirmToken: expect.any(String),
      }),
    );
  });

  it('throws AppError(400) for invalid repo format without checking the repo', async () => {
    await expect(service.subscribe('user@example.com', 'invalid')).rejects.toMatchObject({ status: 400 });
    expect(ensureExists).not.toHaveBeenCalled();
    expect(mockFindByEmailAndRepo).not.toHaveBeenCalled();
  });

  it('propagates AppError(404) from the repository checker', async () => {
    ensureExists.mockRejectedValue(Object.assign(new Error('Repository not found'), { status: 404 }));

    await expect(service.subscribe('user@example.com', 'owner/missing')).rejects.toMatchObject({ status: 404 });
    expect(mockFindByEmailAndRepo).not.toHaveBeenCalled();
  });

  it('propagates AppError(429) from the repository checker', async () => {
    ensureExists.mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }));

    await expect(service.subscribe('user@example.com', 'owner/repo')).rejects.toMatchObject({ status: 429 });
  });

  it('re-issues a fresh confirm token for an existing unconfirmed subscription', async () => {
    const existing = makeAggregate({ confirmed: false });
    mockFindByEmailAndRepo.mockResolvedValue(existing);
    mockSave.mockResolvedValue(undefined);

    await service.subscribe('user@example.com', 'owner/repo');

    const saved = mockSave.mock.calls[0][0];
    expect(saved.confirmToken).not.toBe(existing.confirmToken);
    expect(publish).toHaveBeenCalledWith(
      RoutingKeys.SubscriptionCreated,
      expect.objectContaining({ email: 'user@example.com', repo: 'owner/repo' }),
    );
  });

  it('throws AppError(409) when subscription already confirmed', async () => {
    mockFindByEmailAndRepo.mockResolvedValue(makeAggregate({ confirmed: true }));

    await expect(service.subscribe('user@example.com', 'owner/repo')).rejects.toMatchObject({ status: 409 });
    expect(mockSave).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('confirm', () => {
  it('confirms and persists the subscription for a valid token', async () => {
    mockFindByConfirmToken.mockResolvedValue(makeAggregate({ confirmed: false }));
    mockSave.mockResolvedValue(undefined);

    await service.confirm('token-abc');

    expect(mockSave.mock.calls[0][0].confirmed).toBe(true);
  });

  it('throws AppError(404) when token not found', async () => {
    mockFindByConfirmToken.mockResolvedValue(null);

    await expect(service.confirm('bad-token')).rejects.toMatchObject({ status: 404 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('throws AppError(400) when subscription already confirmed', async () => {
    mockFindByConfirmToken.mockResolvedValue(makeAggregate({ confirmed: true }));

    await expect(service.confirm('token-abc')).rejects.toMatchObject({ status: 400 });
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('unsubscribe', () => {
  it('deletes subscription for valid UUID token', async () => {
    mockFindByUnsubscribeToken.mockResolvedValue(makeAggregate());
    mockDeleteSubscription.mockResolvedValue(undefined);

    await service.unsubscribe(VALID_UUID);

    expect(mockDeleteSubscription).toHaveBeenCalledWith(1);
  });

  it('throws AppError(400) for non-UUID token', async () => {
    await expect(service.unsubscribe('not-a-uuid')).rejects.toMatchObject({ status: 400 });
    expect(mockFindByUnsubscribeToken).not.toHaveBeenCalled();
  });

  it('throws AppError(404) when token not found', async () => {
    mockFindByUnsubscribeToken.mockResolvedValue(null);

    await expect(service.unsubscribe(VALID_UUID)).rejects.toMatchObject({ status: 404 });
    expect(mockDeleteSubscription).not.toHaveBeenCalled();
  });
});
