import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createReleaseScanService,
  type ReleaseScanService,
} from '../../src/modules/repository/scanner.js';
import { RoutingKeys } from '../../src/shared/events.js';
import {
  trackedRepositoryFromRow,
  type RepositoryRow,
} from '../../src/modules/repository/domain/tracked-repository.js';
import { ReleaseTag } from '../../src/modules/repository/domain/release-tag.js';
import { parseOrThrow } from '../../src/shared/domain/parse.js';
import { AppError } from '../../src/shared/appError.js';
import type { ReleaseFetcher } from '../../src/modules/repository/ports/release-fetcher.js';
import type { EventBus } from '../../src/infra/messaging/index.js';

vi.mock('../../src/modules/repository/repository.repository.js', () => ({
  findReposWithConfirmedSubscriptions: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../../src/metrics.js', () => ({
  scansTotal: { inc: vi.fn() },
}));

import {
  findReposWithConfirmedSubscriptions,
  save,
} from '../../src/modules/repository/repository.repository.js';

const mockGetRepos = vi.mocked(findReposWithConfirmedSubscriptions);
const mockSave = vi.mocked(save);

const tag = (v: string) => parseOrThrow(ReleaseTag, v);

function makeRepo(overrides: Partial<RepositoryRow> = {}) {
  return trackedRepositoryFromRow({
    id: 1,
    repo: 'owner/repo',
    last_seen_tag: 'v1.0.0',
    last_checked_at: null,
    ...overrides,
  });
}

let releases: { fetchLatestTag: ReturnType<typeof vi.fn> };
let publish: ReturnType<typeof vi.fn>;
let service: ReleaseScanService;

beforeEach(() => {
  vi.clearAllMocks();
  releases = { fetchLatestTag: vi.fn() };
  publish = vi.fn().mockResolvedValue(undefined);
  service = createReleaseScanService({
    releases: releases as unknown as ReleaseFetcher,
    bus: { publish } as unknown as EventBus,
  });
});

describe('scanOnce', () => {
  it('saves and publishes a release.published event when a new release is detected', async () => {
    mockGetRepos.mockResolvedValue([makeRepo({ last_seen_tag: 'v1.0.0' })]);
    releases.fetchLatestTag.mockResolvedValue(tag('v1.1.0'));
    mockSave.mockResolvedValue(undefined);

    await service.scanOnce();

    expect(mockSave).toHaveBeenCalledOnce();
    expect(mockSave.mock.calls[0][0].lastSeenTag).toBe('v1.1.0');
    expect(publish).toHaveBeenCalledWith(RoutingKeys.ReleasePublished, {
      repo: 'owner/repo',
      tag: 'v1.1.0',
    });
  });

  it('does not save or publish when release tag is unchanged', async () => {
    mockGetRepos.mockResolvedValue([makeRepo({ last_seen_tag: 'v1.0.0' })]);
    releases.fetchLatestTag.mockResolvedValue(tag('v1.0.0'));

    await service.scanOnce();

    expect(mockSave).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not save or publish when there is no latest release', async () => {
    mockGetRepos.mockResolvedValue([makeRepo()]);
    releases.fetchLatestTag.mockResolvedValue(null);

    await service.scanOnce();

    expect(mockSave).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('makes no fetches when there are no repos with confirmed subscriptions', async () => {
    mockGetRepos.mockResolvedValue([]);

    await service.scanOnce();

    expect(releases.fetchLatestTag).not.toHaveBeenCalled();
  });

  it('breaks out of the scan loop on GitHub rate limit (429)', async () => {
    mockGetRepos.mockResolvedValue([
      makeRepo({ id: 1, repo: 'owner/repo1', last_seen_tag: 'v1.0.0' }),
      makeRepo({ id: 2, repo: 'owner/repo2', last_seen_tag: 'v2.0.0' }),
    ]);
    releases.fetchLatestTag.mockRejectedValue(new AppError(429, 'GitHub rate limit exceeded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await service.scanOnce();

    expect(releases.fetchLatestTag).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rate limit'));
    warnSpy.mockRestore();
  });

  it('logs error and continues scanning remaining repos on non-429 error', async () => {
    mockGetRepos.mockResolvedValue([
      makeRepo({ id: 1, repo: 'owner/repo1', last_seen_tag: 'v1.0.0' }),
      makeRepo({ id: 2, repo: 'owner/repo2', last_seen_tag: 'v2.0.0' }),
    ]);
    releases.fetchLatestTag
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce(tag('v2.1.0'));
    mockSave.mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await service.scanOnce();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('owner/repo1'), expect.any(Error));
    expect(mockSave.mock.calls[0][0].repo).toBe('owner/repo2');
    expect(publish).toHaveBeenCalledWith(RoutingKeys.ReleasePublished, {
      repo: 'owner/repo2',
      tag: 'v2.1.0',
    });
    errorSpy.mockRestore();
  });

  it('publishes one event per repo regardless of subscriber count', async () => {
    mockGetRepos.mockResolvedValue([makeRepo({ last_seen_tag: 'v1.0.0' })]);
    releases.fetchLatestTag.mockResolvedValue(tag('v1.1.0'));
    mockSave.mockResolvedValue(undefined);

    await service.scanOnce();

    expect(publish).toHaveBeenCalledTimes(1);
  });
});
