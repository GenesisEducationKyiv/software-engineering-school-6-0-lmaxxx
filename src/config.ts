import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  grpcPort: parseInt(optional('GRPC_PORT', '50051'), 10),

  databaseUrl: required('DATABASE_URL'),

  githubToken: process.env['GITHUB_TOKEN'] ?? null,

  smtp: {
    host: optional('SMTP_HOST', 'smtp.gmail.com'),
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('SMTP_FROM', 'noreply@github-notifier.local'),
  },

  scanIntervalMs: parseInt(optional('SCAN_INTERVAL_MS', '300000'), 10),

  baseUrl: optional('BASE_URL', 'http://localhost:3000'),

  githubApiBaseUrl: optional('GITHUB_API_BASE_URL', 'https://api.github.com'),

  redisUrl: process.env['REDIS_URL'] ?? null,
  redisTtlSeconds: parseInt(optional('REDIS_TTL_SECONDS', '600'), 10),

  rabbitmqUrl: optional('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
} as const;
