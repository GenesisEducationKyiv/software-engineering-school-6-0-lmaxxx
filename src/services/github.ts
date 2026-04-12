import axios from 'axios';
import { config } from '../config.js';
import { AppError } from '../shared/appError.js';
import { githubApiCallsTotal } from '../metrics.js';
import { getCache, setCache } from '../cache/redis.js';

const BASE = 'https://api.github.com';
const CACHE_TTL = config.redisTtlSeconds;
const NULL_SENTINEL = '__NULL__';

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'github-release-notifier',
  };
  if (config.githubToken) {
    h['Authorization'] = `Bearer ${config.githubToken}`;
  }
  return h;
}

export async function checkRepoExists(repo: string): Promise<void> {
  const key = `github:checkRepoExists:${repo}`;
  if (await getCache(key) !== null) return;

  githubApiCallsTotal.inc({ endpoint: 'checkRepoExists' });
  try {
    await axios.get(`${BASE}/repos/${repo}`, { headers: headers() });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) {
        throw new AppError(404, 'Repository not found');
      }
      if (err.response?.status === 429) {
        throw new AppError(429, 'GitHub rate limit exceeded');
      }
    }
    throw err;
  }
  await setCache(key, 'exists', CACHE_TTL);
}

export async function getLatestRelease(repo: string): Promise<{ tag_name: string } | null> {
  const key = `github:getLatestRelease:${repo}`;
  const cached = await getCache(key);
  if (cached !== null) {
    return cached === NULL_SENTINEL ? null : (JSON.parse(cached) as { tag_name: string });
  }

  githubApiCallsTotal.inc({ endpoint: 'getLatestRelease' });
  try {
    const res = await axios.get<{ tag_name: string }>(
      `${BASE}/repos/${repo}/releases/latest`,
      { headers: headers() },
    );
    await setCache(key, JSON.stringify(res.data), CACHE_TTL);
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) {
        await setCache(key, NULL_SENTINEL, CACHE_TTL);
        return null;
      }
      if (err.response?.status === 429) throw new AppError(429, 'GitHub rate limit exceeded');
    }
    throw err;
  }
}
