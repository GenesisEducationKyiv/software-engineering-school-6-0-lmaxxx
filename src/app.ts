import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';
import subscribeRouter from './routes/subscribe.js';
import confirmRouter from './routes/confirm.js';
import unsubscribeRouter from './routes/unsubscribe.js';
import subscriptionsRouter from './routes/subscriptions.js';

export const app = express();

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/subscribe', subscribeRouter);
app.use('/api/confirm', confirmRouter);
app.use('/api/unsubscribe', unsubscribeRouter);
app.use('/api/subscriptions', subscriptionsRouter);

app.use(errorHandler);
