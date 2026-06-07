import { Redis } from 'ioredis';
import { config } from '../../config.js';

function createClient(): Redis | null {
  if (!config.redisUrl) {
    console.log('REDIS_URL not set — caching disabled');
    return null;
  }
  const client = new Redis(config.redisUrl);
  client.on('error', (err: Error) => {
    console.warn('Redis error (caching skipped):', err.message);
  });
  return client;
}

export const redisClient: Redis | null = createClient();

export async function getCache(key: string): Promise<string | null> {
  if (!redisClient) return null;
  try {
    return await redisClient.get(key);
  } catch {
    return null;
  }
}

export async function setCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.set(key, value, 'EX', ttlSeconds);
  } catch {
    // Redis unavailable — ignore
  }
}
