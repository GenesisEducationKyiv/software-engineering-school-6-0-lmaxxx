import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startScanner } from '../../src/modules/repository/scanner.js';
import type { Repository, Subscription } from '../../src/types.js';

vi.mock('../../src/config.js', () => ({
  config: {
    scanIntervalMs: 1000,
  },
}));

vi.mock('../../src/modules/repository/repository.repository.js', () => ({
  getReposWithConfirmedSubscriptions: vi.fn(),
  updateLastSeenTag: vi.fn(),
}));

vi.mock('../../src/modules/subscription/subscription.repository.js', () => ({
  getConfirmedSubscribers: vi.fn(),
}));

vi.mock('../../src/modules/github/index.js', () => ({
  getLatestRelease: vi.fn(),
}));

vi.mock('../../src/infra/mailer.js', () => ({
  sendReleaseNotification: vi.fn(),
}));

vi.mock('../../src/metrics.js', () => ({
  scansTotal: { inc: vi.fn() },
}));

import { getReposWithConfirmedSubscriptions, updateLastSeenTag } from '../../src/modules/repository/repository.repository.js';
import { getConfirmedSubscribers } from '../../src/modules/subscription/subscription.repository.js';
import { getLatestRelease } from '../../src/modules/github/index.js';
import { sendReleaseNotification } from '../../src/infra/mailer.js';

const mockGetRepos = vi.mocked(getReposWithConfirmedSubscriptions);
const mockUpdateLastSeenTag = vi.mocked(updateLastSeenTag);
const mockGetSubscribers = vi.mocked(getConfirmedSubscribers);
const mockGetLatestRelease = vi.mocked(getLatestRelease);
const mockSendReleaseNotification = vi.mocked(sendReleaseNotification);

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    repo: 'owner/repo',
    last_seen_tag: 'v1.0.0',
    last_checked_at: null,
    ...overrides,
  };
}

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    email: 'user@example.com',
    repo: 'owner/repo',
    confirmed: true,
    confirm_token: 'c-token',
    unsubscribe_token: 'u-token',
    created_at: new Date(),
    ...overrides,
  };
}

describe('startScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('sends notifications when a new release is detected', async () => {
    const repo = makeRepo({ last_seen_tag: 'v1.0.0' });
    const subscriber = makeSub({ unsubscribe_token: 'u-token' });

    mockGetRepos.mockResolvedValue([repo]);
    mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.1.0' });
    mockUpdateLastSeenTag.mockResolvedValue(undefined);
    mockGetSubscribers.mockResolvedValue([subscriber]);
    mockSendReleaseNotification.mockResolvedValue(undefined);

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockUpdateLastSeenTag).toHaveBeenCalledWith(1, 'v1.1.0');
    expect(mockSendReleaseNotification).toHaveBeenCalledWith(
      'user@example.com',
      'owner/repo',
      'v1.1.0',
      'u-token',
    );
  });

  it('does not update or notify when release tag is unchanged', async () => {
    mockGetRepos.mockResolvedValue([makeRepo({ last_seen_tag: 'v1.0.0' })]);
    mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.0.0' });

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockUpdateLastSeenTag).not.toHaveBeenCalled();
    expect(mockSendReleaseNotification).not.toHaveBeenCalled();
  });

  it('does not update or notify when getLatestRelease returns null', async () => {
    mockGetRepos.mockResolvedValue([makeRepo()]);
    mockGetLatestRelease.mockResolvedValue(null);

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockUpdateLastSeenTag).not.toHaveBeenCalled();
    expect(mockSendReleaseNotification).not.toHaveBeenCalled();
  });

  it('makes no GitHub calls when there are no repos with confirmed subscriptions', async () => {
    mockGetRepos.mockResolvedValue([]);

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockGetLatestRelease).not.toHaveBeenCalled();
  });

  it('breaks out of scan loop on GitHub rate limit (429)', async () => {
    const { AppError } = await import('../../src/shared/appError.js');
    const repo1 = makeRepo({ id: 1, repo: 'owner/repo1', last_seen_tag: 'v1.0.0' });
    const repo2 = makeRepo({ id: 2, repo: 'owner/repo2', last_seen_tag: 'v2.0.0' });

    mockGetRepos.mockResolvedValue([repo1, repo2]);
    mockGetLatestRelease.mockRejectedValue(new AppError(429, 'GitHub rate limit exceeded'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockGetLatestRelease).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rate limit'));

    warnSpy.mockRestore();
  });

  it('logs error and continues scanning remaining repos on non-429 error', async () => {
    const repo1 = makeRepo({ id: 1, repo: 'owner/repo1', last_seen_tag: 'v1.0.0' });
    const repo2 = makeRepo({ id: 2, repo: 'owner/repo2', last_seen_tag: 'v2.0.0' });
    const subscriber = makeSub({ repo: 'owner/repo2', unsubscribe_token: 'u2' });

    mockGetRepos.mockResolvedValue([repo1, repo2]);
    mockGetLatestRelease
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce({ tag_name: 'v2.1.0' });
    mockUpdateLastSeenTag.mockResolvedValue(undefined);
    mockGetSubscribers.mockResolvedValue([subscriber]);
    mockSendReleaseNotification.mockResolvedValue(undefined);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('owner/repo1'),
      expect.any(Error),
    );
    expect(mockUpdateLastSeenTag).toHaveBeenCalledWith(2, 'v2.1.0');
    expect(mockSendReleaseNotification).toHaveBeenCalledWith(
      subscriber.email,
      'owner/repo2',
      'v2.1.0',
      'u2',
    );

    errorSpy.mockRestore();
  });

  it('sends notifications to all confirmed subscribers of a repo', async () => {
    const repo = makeRepo({ last_seen_tag: 'v1.0.0' });
    const sub1 = makeSub({ id: 1, email: 'a@example.com', unsubscribe_token: 'u1' });
    const sub2 = makeSub({ id: 2, email: 'b@example.com', unsubscribe_token: 'u2' });

    mockGetRepos.mockResolvedValue([repo]);
    mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.1.0' });
    mockUpdateLastSeenTag.mockResolvedValue(undefined);
    mockGetSubscribers.mockResolvedValue([sub1, sub2]);
    mockSendReleaseNotification.mockResolvedValue(undefined);

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockSendReleaseNotification).toHaveBeenCalledTimes(2);
    expect(mockSendReleaseNotification).toHaveBeenCalledWith('a@example.com', 'owner/repo', 'v1.1.0', 'u1');
    expect(mockSendReleaseNotification).toHaveBeenCalledWith('b@example.com', 'owner/repo', 'v1.1.0', 'u2');
  });
});
