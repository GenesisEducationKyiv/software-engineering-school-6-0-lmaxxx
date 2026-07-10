import { Counter, Histogram, Gauge, Registry } from 'prom-client';

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

export const scanDurationSeconds = new Histogram({
  name: 'scan_duration_seconds',
  help: 'Scanner cycle duration in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const githubApiDurationSeconds = new Histogram({
  name: 'github_api_duration_seconds',
  help: 'GitHub API call duration in seconds',
  labelNames: ['endpoint'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const grpcRequestsTotal = new Counter({
  name: 'grpc_requests_total',
  help: 'Total gRPC requests',
  labelNames: ['method', 'status'] as const,
  registers: [register],
});

export const grpcRequestDurationSeconds = new Histogram({
  name: 'grpc_request_duration_seconds',
  help: 'gRPC request duration in seconds',
  labelNames: ['method', 'status'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [register],
});

export const activeSubscriptionsTotal = new Gauge({
  name: 'active_subscriptions_total',
  help: 'Number of confirmed active subscriptions (updated per scan cycle)',
  registers: [register],
});
