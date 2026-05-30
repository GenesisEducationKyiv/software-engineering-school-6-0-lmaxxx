import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { checkRepoExists, getLatestRelease } from '../../src/services/github.js';
import { getCache, setCache } from '../../src/cache/redis.js';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

vi.mock('../../src/config.js', () => ({
  config: {
    githubToken: '',
    redisTtlSeconds: 600,
  },
}));

vi.mock('../../src/cache/redis.js', () => ({
  redisClient: null,
  getCache: vi.fn().mockResolvedValue(null),
  setCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/metrics.js', () => ({
  githubApiCallsTotal: { inc: vi.fn() },
  githubApiDurationSeconds: { startTimer: vi.fn().mockReturnValue(vi.fn()) },
}));

const mockAxios = vi.mocked(axios);

function makeAxiosError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status },
  });
}

const mockGetCache = vi.mocked(getCache);
const mockSetCache = vi.mocked(setCache);

describe('checkRepoExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves without error when repo exists', async () => {
    mockAxios.get.mockResolvedValue({ status: 200, data: {} });
    mockAxios.isAxiosError.mockReturnValue(false);

    await expect(checkRepoExists('owner/repo')).resolves.toBeUndefined();
    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('throws AppError(404) when repo not found', async () => {
    const err = makeAxiosError(404);
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(true);

    await expect(checkRepoExists('owner/missing')).rejects.toMatchObject({
      status: 404,
      message: 'Repository not found',
    });
  });

  it('throws AppError(429) on rate limit', async () => {
    const err = makeAxiosError(429);
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(true);

    await expect(checkRepoExists('owner/repo')).rejects.toMatchObject({
      status: 429,
      message: 'GitHub rate limit exceeded',
    });
  });

  it('re-throws non-axios errors unchanged', async () => {
    const err = new Error('network failure');
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(false);

    await expect(checkRepoExists('owner/repo')).rejects.toThrow('network failure');
  });

  it('re-throws axios errors with unexpected status codes unchanged', async () => {
    const err = makeAxiosError(500);
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(true);

    await expect(checkRepoExists('owner/repo')).rejects.toBe(err);
  });

  it('sends correct headers including Authorization when token is set', async () => {
    const { config } = await import('../../src/config.js');
    (config as { githubToken: string }).githubToken = 'test-token';

    mockAxios.get.mockResolvedValue({ status: 200, data: {} });
    mockAxios.isAxiosError.mockReturnValue(false);

    await checkRepoExists('owner/repo');

    expect(mockAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'github-release-notifier',
        }),
      }),
    );

    (config as { githubToken: string }).githubToken = '';
  });

  it('returns early on cache hit without calling GitHub API', async () => {
    mockGetCache.mockResolvedValueOnce('exists');

    await expect(checkRepoExists('owner/repo')).resolves.toBeUndefined();
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it('stores result in cache after successful API call', async () => {
    mockAxios.get.mockResolvedValue({ status: 200, data: {} });
    mockAxios.isAxiosError.mockReturnValue(false);

    await checkRepoExists('owner/repo');

    expect(mockSetCache).toHaveBeenCalledWith('github:checkRepoExists:owner/repo', 'exists', 600);
  });

  it('does not cache on 404', async () => {
    const err = makeAxiosError(404);
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(true);

    await expect(checkRepoExists('owner/repo')).rejects.toMatchObject({ status: 404 });
    expect(mockSetCache).not.toHaveBeenCalled();
  });
});

describe('getLatestRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the release object on success', async () => {
    mockAxios.get.mockResolvedValue({ data: { tag_name: 'v1.2.3' } });
    mockAxios.isAxiosError.mockReturnValue(false);

    const result = await getLatestRelease('owner/repo');
    expect(result).toEqual({ tag_name: 'v1.2.3' });
  });

  it('returns null when no releases exist (404)', async () => {
    const err = makeAxiosError(404);
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(true);

    const result = await getLatestRelease('owner/repo');
    expect(result).toBeNull();
  });

  it('throws AppError(429) on rate limit', async () => {
    const err = makeAxiosError(429);
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(true);

    await expect(getLatestRelease('owner/repo')).rejects.toMatchObject({ status: 429 });
  });

  it('re-throws non-axios errors unchanged', async () => {
    const err = new Error('connection refused');
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(false);

    await expect(getLatestRelease('owner/repo')).rejects.toThrow('connection refused');
  });

  it('returns cached release without calling GitHub API', async () => {
    mockGetCache.mockResolvedValueOnce(JSON.stringify({ tag_name: 'v2.0.0' }));

    const result = await getLatestRelease('owner/repo');

    expect(result).toEqual({ tag_name: 'v2.0.0' });
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it('returns null on cache hit with null sentinel without calling GitHub API', async () => {
    mockGetCache.mockResolvedValueOnce('__NULL__');

    const result = await getLatestRelease('owner/repo');

    expect(result).toBeNull();
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it('stores release in cache after successful API call', async () => {
    mockAxios.get.mockResolvedValue({ data: { tag_name: 'v1.2.3' } });
    mockAxios.isAxiosError.mockReturnValue(false);

    await getLatestRelease('owner/repo');

    expect(mockSetCache).toHaveBeenCalledWith(
      'github:getLatestRelease:owner/repo',
      JSON.stringify({ tag_name: 'v1.2.3' }),
      600,
    );
  });

  it('stores null sentinel in cache when repo has no releases', async () => {
    const err = makeAxiosError(404);
    mockAxios.get.mockRejectedValue(err);
    mockAxios.isAxiosError.mockReturnValue(true);

    const result = await getLatestRelease('owner/repo');

    expect(result).toBeNull();
    expect(mockSetCache).toHaveBeenCalledWith('github:getLatestRelease:owner/repo', '__NULL__', 600);
  });
});
