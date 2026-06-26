import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { AppError } from '../../src/shared/appError.js';

vi.mock('../../src/logger.js', () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { logger } from '../../src/logger.js';

const mockLogger = vi.mocked(logger);

function makeReqRes(body: unknown, reqLog?: { error: ReturnType<typeof vi.fn> }) {
  const req = {
    method: 'POST',
    originalUrl: '/api/subscribe',
    body,
    ...(reqLog ? { log: reqLog } : {}),
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the error with status and email, then responds with the AppError status', () => {
    const { req, res } = makeReqRes({ email: 'vasya@example.com', repo: 'owner/repo' });

    errorHandler(new AppError(409, 'Already subscribed'), req, res, vi.fn());

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 409,
        email: 'vasya@example.com',
        method: 'POST',
        url: '/api/subscribe',
      }),
      'request handler error',
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Already subscribed' });
  });

  it('defaults to status 500 for non-AppError and omits email when absent', () => {
    const { req, res } = makeReqRes(undefined);

    errorHandler(new Error('boom'), req, res, vi.fn());

    const [logPayload] = mockLogger.error.mock.calls[0];
    expect(logPayload).toMatchObject({ status: 500 });
    expect(logPayload).not.toHaveProperty('email');
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('prefers the pino-http per-request child logger when present', () => {
    const reqLog = { error: vi.fn() };
    const { req, res } = makeReqRes({ email: 'a@b.com' }, reqLog);

    errorHandler(new AppError(404, 'not found'), req, res, vi.fn());

    expect(reqLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.com', status: 404 }),
      'request handler error',
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
