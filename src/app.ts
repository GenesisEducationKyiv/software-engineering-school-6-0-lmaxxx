import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import subscribeRouter from './routes/subscribe.js';
import confirmRouter from './routes/confirm.js';
import unsubscribeRouter from './routes/unsubscribe.js';
import subscriptionsRouter from './routes/subscriptions.js';
import { register } from './metrics.js';

export const app = express();

app.use(express.json());
app.use(metricsMiddleware);

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/subscribe', subscribeRouter);
app.use('/api/confirm', confirmRouter);
app.use('/api/unsubscribe', unsubscribeRouter);
app.use('/api/subscriptions', subscriptionsRouter);

app.use(errorHandler);
