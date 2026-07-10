import express, { type Express } from 'express';
import path from 'path';
import { pinoHttp } from 'pino-http';
import { errorHandler } from './middleware/errorHandler.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import { createSubscriptionRouter } from './modules/subscription/routes/index.js';
import type { SubscriptionService } from './modules/subscription/subscription.service.js';
import type { SagaOrchestrator } from './infra/saga/types.js';
import { register } from './metrics.js';
import { logger } from './logger.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Builds the Express app around an injected subscription service. */
export function createApp(
  subscriptionService: SubscriptionService,
  sagaOrchestrator?: SagaOrchestrator,
): Express {
  const app = express();

  app.use(express.json());
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req: { url?: string }) => req.url === '/metrics' },
    customLogLevel: (_req: unknown, res: { statusCode: number }) => {
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));
  app.use(metricsMiddleware);

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use('/api', createSubscriptionRouter(subscriptionService, sagaOrchestrator));

  app.use(errorHandler);

  return app;
}
