import express, { type Express } from 'express';
import path from 'path';
import { errorHandler } from './middleware/errorHandler.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import { createSubscriptionRouter } from './modules/subscription/routes/index.js';
import type { SubscriptionService } from './modules/subscription/subscription.service.js';
import { register } from './metrics.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Builds the Express app around an injected subscription service. */
export function createApp(subscriptionService: SubscriptionService): Express {
  const app = express();

  app.use(express.json());
  app.use(metricsMiddleware);

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  app.use('/api', createSubscriptionRouter(subscriptionService));

  app.use(errorHandler);

  return app;
}
