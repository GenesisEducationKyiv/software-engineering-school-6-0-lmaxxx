import pino from 'pino';
import { config } from './config.js';

const transport = config.nodeEnv === 'development'
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
  : undefined;

export const logger = pino({
  level: config.logLevel,
  transport,
  base: { service: 'github-notifier', version: '1.0.0', env: config.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
});
