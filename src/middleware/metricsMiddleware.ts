import { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDurationSeconds } from '../metrics.js';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const expressRoute = req.route as { path?: string } | undefined;
    const route = typeof expressRoute?.path === 'string' ? expressRoute.path : 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}