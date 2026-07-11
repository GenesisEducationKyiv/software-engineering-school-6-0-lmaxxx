import { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';
import { logger } from '../logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : 'Internal server error';
  const status = (err as { status?: number }).status ?? 500;

  // pino-http attaches a per-request child logger (carries req.id) — use it so the
  // error line correlates with the access log. Fall back to the base logger.
  const log = (req as Request & { log?: Logger }).log ?? logger;
  const email = (req.body as { email?: unknown } | undefined)?.email;
  log.error(
    {
      err,
      status,
      method: req.method,
      url: req.originalUrl,
      ...(typeof email === 'string' ? { email } : {}),
    },
    'request handler error',
  );

  res.status(status).json({ error: message });
}
