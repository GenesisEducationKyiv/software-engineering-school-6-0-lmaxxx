import { Redis } from 'ioredis';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

function createClient(): Redis | null {
  if (!config.redisUrl) {
    logger.info('Redis URL not set — caching disabled');
    return null;
  }
  const client = new Redis(config.redisUrl);
  client.on('error', (err: Error) => {
    logger.warn({ err: err.message }, 'Redis error (caching skipped)');
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
