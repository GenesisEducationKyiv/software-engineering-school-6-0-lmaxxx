import { Counter, Histogram, Registry } from 'prom-client';

export const register = new Registry();

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

export const scansTotal = new Counter({
  name: 'scans_total',
  help: 'Total scanner cycles completed',
  registers: [register],
});

export const emailsSentTotal = new Counter({
  name: 'emails_sent_total',
  help: 'Total emails sent',
  labelNames: ['type'] as const,
  registers: [register],
});

export const githubApiCallsTotal = new Counter({
  name: 'github_api_calls_total',
  help: 'Total GitHub API calls made',
  labelNames: ['endpoint'] as const,
  registers: [register],
});
