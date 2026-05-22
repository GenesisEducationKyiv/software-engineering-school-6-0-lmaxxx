import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { IncomingHttpHeaders } from 'http';

const MOCK_PORT = vi.hoisted(() => 4002);

vi.mock('../../src/config.js', () => ({
  config: {
    githubApiBaseUrl: `http://localhost:${MOCK_PORT}`,
    redisTtlSeconds: 600,
    githubToken: '',
  },
}));

vi.mock('../../src/cache/redis.js', () => ({
  getCache: vi.fn().mockResolvedValue(null),
  setCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/metrics.js', () => ({
  githubApiCallsTotal: { inc: vi.fn() },
}));

import { checkRepoExists, getLatestRelease } from '../../src/services/github.js';
import { getCache, setCache } from '../../src/cache/redis.js';
import { config } from '../../src/config.js';
import { AppError } from '../../src/shared/appError.js';

const mockGetCache = vi.mocked(getCache);
const mockSetCache = vi.mocked(setCache);
const mockConfig = config as { githubApiBaseUrl: string; redisTtlSeconds: number; githubToken: string | null };

const state = {
  repoStatus: 200,
  repoBody: { full_name: 'owner/repo' } as object,
  releaseStatus: 200,
  releaseBody: { tag_name: 'v1.0.0' } as object,
  lastRepoHeaders: null as IncomingHttpHeaders | null,
  lastReleaseHeaders: null as IncomingHttpHeaders | null,
  repoCalled: 0,
  releaseCalled: 0,
};

let server: Server;

beforeAll(async () => {
  const app = express();

  app.get('/repos/:owner/:repo', (req, res) => {
    state.lastRepoHeaders = req.headers;
    state.repoCalled++;
    res.status(state.repoStatus).json(state.repoBody);
  });

  app.get('/repos/:owner/:repo/releases/latest', (req, res) => {
    state.lastReleaseHeaders = req.headers;
    state.releaseCalled++;
    res.status(state.releaseStatus).json(state.releaseBody);
  });

  await new Promise<void>((resolve) => {
    server = app.listen(MOCK_PORT, resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCache.mockResolvedValue(null);
  mockConfig.githubToken = '';
  state.repoStatus = 200;
  state.repoBody = { full_name: 'owner/repo' };
  state.releaseStatus = 200;
  state.releaseBody = { tag_name: 'v1.0.0' };
  state.lastRepoHeaders = null;
  state.lastReleaseHeaders = null;
  state.repoCalled = 0;
  state.releaseCalled = 0;
});

describe('checkRepoExists', () => {
  it('resolves and caches when repo exists', async () => {
    await expect(checkRepoExists('owner/repo')).resolves.toBeUndefined();
    expect(mockSetCache).toHaveBeenCalledWith('github:checkRepoExists:owner/repo', 'exists', 600);
  });

  it('throws AppError(404) when repo not found', async () => {
    state.repoStatus = 404;

    expect(checkRepoExists('owner/missing')).rejects.toMatchObject({
      status: 404,
      message: 'Repository not found',
    });
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it('throws AppError(429) on 429 rate limit response', async () => {
    state.repoStatus = 429;

    expect(checkRepoExists('owner/repo')).rejects.toMatchObject({
      status: 429,
      message: 'GitHub rate limit exceeded',
    });
  });

  it('throws AppError(429) on 403 forbidden response', async () => {
    state.repoStatus = 403;

    expect(checkRepoExists('owner/repo')).rejects.toMatchObject({
      status: 429,
      message: 'GitHub rate limit exceeded',
    });
  });

  it('returns early on cache hit without calling the server', async () => {
    mockGetCache.mockResolvedValue('exists');

    await expect(checkRepoExists('owner/repo')).resolves.toBeUndefined();
    expect(state.repoCalled).toBe(0);
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it('propagates non-4xx server errors without wrapping', async () => {
    state.repoStatus = 500;

    const err = await checkRepoExists('owner/repo').catch((e) => e);
    expect(err).not.toBeInstanceOf(AppError);
  });

  it('sends Authorization header when githubToken is set', async () => {
    mockConfig.githubToken = 'test-token';

    await checkRepoExists('owner/repo');
    expect(state.lastRepoHeaders?.['authorization']).toBe('Bearer test-token');
  });

  it('omits Authorization header when githubToken is empty', async () => {
    mockConfig.githubToken = '';

    await checkRepoExists('owner/repo');
    expect(state.lastRepoHeaders?.['authorization']).toBeUndefined();
  });
});

describe('getLatestRelease', () => {
  it('returns release data and caches it', async () => {
    state.releaseBody = { tag_name: 'v2.3.0' };

    const result = await getLatestRelease('owner/repo');
    expect(result).toEqual({ tag_name: 'v2.3.0' });
    expect(mockSetCache).toHaveBeenCalledWith(
      'github:getLatestRelease:owner/repo',
      JSON.stringify({ tag_name: 'v2.3.0' }),
      600,
    );
  });

  it('returns null and caches NULL_SENTINEL when no releases (404)', async () => {
    state.releaseStatus = 404;

    const result = await getLatestRelease('owner/repo');
    expect(result).toBeNull();
    expect(mockSetCache).toHaveBeenCalledWith('github:getLatestRelease:owner/repo', '__NULL__', 600);
  });

  it('throws AppError(429) on 429 rate limit response', async () => {
    state.releaseStatus = 429;

    expect(getLatestRelease('owner/repo')).rejects.toMatchObject({
      status: 429,
      message: 'GitHub rate limit exceeded',
    });
  });

  it('throws AppError(429) on 403 forbidden response', async () => {
    state.releaseStatus = 403;

    expect(getLatestRelease('owner/repo')).rejects.toMatchObject({
      status: 429,
      message: 'GitHub rate limit exceeded',
    });
  });

  it('returns parsed release from cache without calling the server', async () => {
    mockGetCache.mockResolvedValue(JSON.stringify({ tag_name: 'v1.0.0' }));

    const result = await getLatestRelease('owner/repo');
    expect(result).toEqual({ tag_name: 'v1.0.0' });
    expect(state.releaseCalled).toBe(0);
  });

  it('returns null from cache when NULL_SENTINEL is cached', async () => {
    mockGetCache.mockResolvedValue('__NULL__');

    const result = await getLatestRelease('owner/repo');
    expect(result).toBeNull();
    expect(state.releaseCalled).toBe(0);
  });

  it('propagates non-4xx server errors without wrapping', async () => {
    state.releaseStatus = 500;

    const err = await getLatestRelease('owner/repo').catch((e) => e);
    expect(err).not.toBeInstanceOf(AppError);
  });

  it('sends Authorization header when githubToken is set', async () => {
    mockConfig.githubToken = 'test-token';

    await getLatestRelease('owner/repo');
    expect(state.lastReleaseHeaders?.['authorization']).toBe('Bearer test-token');
  });
});
