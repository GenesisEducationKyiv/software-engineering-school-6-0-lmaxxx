import axios from 'axios';
import { config } from '../config.js';
import {AppError} from "../shared/appError.js";

const BASE = 'https://api.github.com';

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
}

export async function getLatestRelease(repo: string): Promise<{ tag_name: string } | null> {
  try {
    const res = await axios.get<{ tag_name: string }>(
      `${BASE}/repos/${repo}/releases/latest`,
      { headers: headers() },
    );
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) return null;
      if (err.response?.status === 429) throw new AppError(429, 'GitHub rate limit exceeded');
    }
    throw err;
  }
}
