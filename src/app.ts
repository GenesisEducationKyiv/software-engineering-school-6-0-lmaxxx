import express from 'express';
import path from 'path';
import { errorHandler } from './middleware/errorHandler.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import subscriptionRouter from './modules/subscription/routes/index.js';
import { register } from './metrics.js';
import { fileURLToPath } from 'url';

export const app = express();

app.use(express.json());
app.use(metricsMiddleware);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/api', subscriptionRouter);

app.use(errorHandler);
