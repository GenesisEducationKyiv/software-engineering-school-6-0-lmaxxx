import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateRepoFormat,
  createSubscription,
  confirmSubscription,
  unsubscribeUser,
} from '../../src/services/subscription.js';
import type { Subscription } from '../../src/types.js';

vi.mock('uuid', () => ({
  v4: vi.fn(),
}));

vi.mock('../../src/services/github.js', () => ({
  checkRepoExists: vi.fn(),
}));

vi.mock('../../src/services/email.js', () => ({
  sendConfirmationEmail: vi.fn(),
}));

vi.mock('../../src/db/subscriptions.js', () => ({
  findByEmailAndRepo: vi.fn(),
  insertSubscription: vi.fn(),
  updateConfirmToken: vi.fn(),
  findByConfirmToken: vi.fn(),
  markConfirmed: vi.fn(),
  findByUnsubscribeToken: vi.fn(),
  deleteSubscription: vi.fn(),
  findConfirmedByEmail: vi.fn(),
  getConfirmedSubscribers: vi.fn(),
}));

vi.mock('../../src/db/repositories.js', () => ({
  upsertRepository: vi.fn(),
}));

import { v4 as uuidv4 } from 'uuid';
import { checkRepoExists } from '../../src/services/github.js';
import { sendConfirmationEmail } from '../../src/services/email.js';
import {
  findByEmailAndRepo,
  insertSubscription,
  updateConfirmToken,
  findByConfirmToken,
  markConfirmed,
  findByUnsubscribeToken,
  deleteSubscription,
} from '../../src/db/subscriptions.js';
import { upsertRepository } from '../../src/db/repositories.js';

const mockUuid = vi.mocked(uuidv4);
const mockCheckRepoExists = vi.mocked(checkRepoExists);
const mockSendConfirmationEmail = vi.mocked(sendConfirmationEmail);
const mockFindByEmailAndRepo = vi.mocked(findByEmailAndRepo);
const mockInsertSubscription = vi.mocked(insertSubscription);
const mockUpdateConfirmToken = vi.mocked(updateConfirmToken);
const mockFindByConfirmToken = vi.mocked(findByConfirmToken);
const mockMarkConfirmed = vi.mocked(markConfirmed);
const mockFindByUnsubscribeToken = vi.mocked(findByUnsubscribeToken);
const mockDeleteSubscription = vi.mocked(deleteSubscription);
const mockUpsertRepository = vi.mocked(upsertRepository);

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    email: 'user@example.com',
    repo: 'owner/repo',
    confirmed: false,
    confirm_token: 'token-abc',
    unsubscribe_token: 'token-xyz',
    created_at: new Date(),
    ...overrides,
  };
}

describe('validateRepoFormat', () => {
  it('accepts valid owner/repo', () => {
    expect(validateRepoFormat('golang/go')).toBe(true);
  });

  it('accepts names with hyphens, dots, and underscores', () => {
    expect(validateRepoFormat('my-org/my_repo.v2')).toBe(true);
  });

  it('rejects missing slash', () => {
    expect(validateRepoFormat('invalid')).toBe(false);
  });

  it('rejects empty owner', () => {
    expect(validateRepoFormat('/repo')).toBe(false);
  });

  it('rejects empty repo', () => {
    expect(validateRepoFormat('owner/')).toBe(false);
  });

  it('rejects multiple slashes', () => {
    expect(validateRepoFormat('a/b/c')).toBe(false);
  });
});

describe('createSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new subscription and sends confirmation email', async () => {
    mockCheckRepoExists.mockResolvedValue(undefined);
    mockFindByEmailAndRepo.mockResolvedValue(null);
    mockUuid
      .mockReturnValueOnce('confirm-token' as unknown as `${string}-${string}-${string}-${string}-${string}`)
      .mockReturnValueOnce('unsub-token' as unknown as `${string}-${string}-${string}-${string}-${string}`);
    mockInsertSubscription.mockResolvedValue(makeSub());
    mockUpsertRepository.mockResolvedValue(undefined);
    mockSendConfirmationEmail.mockResolvedValue(undefined);

    await createSubscription('user@example.com', 'owner/repo');

    expect(mockCheckRepoExists).toHaveBeenCalledWith('owner/repo');
    expect(mockInsertSubscription).toHaveBeenCalledWith(
      'user@example.com',
      'owner/repo',
      'confirm-token',
      'unsub-token',
    );
    expect(mockUpsertRepository).toHaveBeenCalledWith('owner/repo');
    expect(mockSendConfirmationEmail).toHaveBeenCalledWith('user@example.com', 'owner/repo', 'confirm-token');
  });

  it('throws AppError(400) for invalid repo format without calling anything', async () => {
    await expect(createSubscription('user@example.com', 'invalid')).rejects.toMatchObject({
      status: 400,
    });

    expect(mockCheckRepoExists).not.toHaveBeenCalled();
    expect(mockFindByEmailAndRepo).not.toHaveBeenCalled();
  });

  it('propagates AppError(404) from checkRepoExists', async () => {
    mockCheckRepoExists.mockRejectedValue(
      Object.assign(new Error('Repository not found'), { status: 404 }),
    );

    await expect(createSubscription('user@example.com', 'owner/missing')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockFindByEmailAndRepo).not.toHaveBeenCalled();
  });

  it('propagates AppError(429) from checkRepoExists', async () => {
    mockCheckRepoExists.mockRejectedValue(
      Object.assign(new Error('GitHub rate limit exceeded'), { status: 429 }),
    );

    await expect(createSubscription('user@example.com', 'owner/repo')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('resends confirmation email for existing unconfirmed subscription', async () => {
    const existingSub = makeSub({ confirmed: false });
    mockCheckRepoExists.mockResolvedValue(undefined);
    mockFindByEmailAndRepo.mockResolvedValue(existingSub);
    mockUuid.mockReturnValueOnce('new-token' as unknown as `${string}-${string}-${string}-${string}-${string}`);
    mockUpdateConfirmToken.mockResolvedValue(undefined);
    mockSendConfirmationEmail.mockResolvedValue(undefined);

    await createSubscription('user@example.com', 'owner/repo');

    expect(mockUpdateConfirmToken).toHaveBeenCalledWith(1, 'new-token');
    expect(mockSendConfirmationEmail).toHaveBeenCalledWith('user@example.com', 'owner/repo', 'new-token');
    expect(mockInsertSubscription).not.toHaveBeenCalled();
  });

  it('throws AppError(409) when subscription already confirmed', async () => {
    mockCheckRepoExists.mockResolvedValue(undefined);
    mockFindByEmailAndRepo.mockResolvedValue(makeSub({ confirmed: true }));

    await expect(createSubscription('user@example.com', 'owner/repo')).rejects.toMatchObject({
      status: 409,
    });

    expect(mockInsertSubscription).not.toHaveBeenCalled();
    expect(mockSendConfirmationEmail).not.toHaveBeenCalled();
  });
});

describe('confirmSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks subscription confirmed for a valid token', async () => {
    mockFindByConfirmToken.mockResolvedValue(makeSub({ confirmed: false }));
    mockMarkConfirmed.mockResolvedValue(undefined);

    await confirmSubscription('token-abc');

    expect(mockMarkConfirmed).toHaveBeenCalledWith(1);
  });

  it('throws AppError(404) when token not found', async () => {
    mockFindByConfirmToken.mockResolvedValue(null);

    await expect(confirmSubscription('bad-token')).rejects.toMatchObject({ status: 404 });
    expect(mockMarkConfirmed).not.toHaveBeenCalled();
  });

  it('throws AppError(400) when subscription already confirmed', async () => {
    mockFindByConfirmToken.mockResolvedValue(makeSub({ confirmed: true }));

    await expect(confirmSubscription('token-abc')).rejects.toMatchObject({ status: 400 });
    expect(mockMarkConfirmed).not.toHaveBeenCalled();
  });
});

describe('unsubscribeUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes subscription for a valid unsubscribe token', async () => {
    mockFindByUnsubscribeToken.mockResolvedValue(makeSub());
    mockDeleteSubscription.mockResolvedValue(undefined);

    await unsubscribeUser('00000000-0000-0000-0000-000000000000');

    expect(mockDeleteSubscription).toHaveBeenCalledWith(1);
  });

  it('throws AppError(400) for a malformed (non-UUID) token', async () => {
    await expect(unsubscribeUser('not-a-uuid')).rejects.toMatchObject({ status: 400 });
    expect(mockFindByUnsubscribeToken).not.toHaveBeenCalled();
    expect(mockDeleteSubscription).not.toHaveBeenCalled();
  });

  it('throws AppError(404) when unsubscribe token not found', async () => {
    mockFindByUnsubscribeToken.mockResolvedValue(null);

    await expect(unsubscribeUser('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 });
    expect(mockDeleteSubscription).not.toHaveBeenCalled();
  });
});
