import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startScanner } from '../../src/modules/repository/scanner.js';
import { RoutingKeys } from '../../src/shared/events.js';
import type { Repository } from '../../src/types.js';

vi.mock('../../src/config.js', () => ({
  config: {
    scanIntervalMs: 1000,
  },
}));

vi.mock('../../src/modules/repository/repository.repository.js', () => ({
  getReposWithConfirmedSubscriptions: vi.fn(),
  updateLastSeenTag: vi.fn(),
}));

vi.mock('../../src/modules/github/index.js', () => ({
  getLatestRelease: vi.fn(),
}));

const mockPublish = vi.fn();
vi.mock('../../src/infra/messaging/index.js', () => ({
  getBus: () => ({ publish: mockPublish }),
}));

vi.mock('../../src/metrics.js', () => ({
  scansTotal: { inc: vi.fn() },
}));

import { getReposWithConfirmedSubscriptions, updateLastSeenTag } from '../../src/modules/repository/repository.repository.js';
import { getLatestRelease } from '../../src/modules/github/index.js';

const mockGetRepos = vi.mocked(getReposWithConfirmedSubscriptions);
const mockUpdateLastSeenTag = vi.mocked(updateLastSeenTag);
const mockGetLatestRelease = vi.mocked(getLatestRelease);

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    repo: 'owner/repo',
    last_seen_tag: 'v1.0.0',
    last_checked_at: null,
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

  it('publishes a release.published event when a new release is detected', async () => {
    const repo = makeRepo({ last_seen_tag: 'v1.0.0' });

    mockGetRepos.mockResolvedValue([repo]);
    mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.1.0' });
    mockUpdateLastSeenTag.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(undefined);

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockUpdateLastSeenTag).toHaveBeenCalledWith(1, 'v1.1.0');
    expect(mockPublish).toHaveBeenCalledWith(RoutingKeys.ReleasePublished, {
      repo: 'owner/repo',
      tag: 'v1.1.0',
    });
  });

  it('does not update or publish when release tag is unchanged', async () => {
    mockGetRepos.mockResolvedValue([makeRepo({ last_seen_tag: 'v1.0.0' })]);
    mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.0.0' });

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockUpdateLastSeenTag).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('does not update or publish when getLatestRelease returns null', async () => {
    mockGetRepos.mockResolvedValue([makeRepo()]);
    mockGetLatestRelease.mockResolvedValue(null);

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockUpdateLastSeenTag).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
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

    mockGetRepos.mockResolvedValue([repo1, repo2]);
    mockGetLatestRelease
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce({ tag_name: 'v2.1.0' });
    mockUpdateLastSeenTag.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(undefined);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('owner/repo1'),
      expect.any(Error),
    );
    expect(mockUpdateLastSeenTag).toHaveBeenCalledWith(2, 'v2.1.0');
    expect(mockPublish).toHaveBeenCalledWith(RoutingKeys.ReleasePublished, {
      repo: 'owner/repo2',
      tag: 'v2.1.0',
    });

    errorSpy.mockRestore();
  });

  it('publishes one event per repo regardless of subscriber count', async () => {
    const repo = makeRepo({ last_seen_tag: 'v1.0.0' });

    mockGetRepos.mockResolvedValue([repo]);
    mockGetLatestRelease.mockResolvedValue({ tag_name: 'v1.1.0' });
    mockUpdateLastSeenTag.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(undefined);

    startScanner();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(RoutingKeys.ReleasePublished, {
      repo: 'owner/repo',
      tag: 'v1.1.0',
    });
  });
});
