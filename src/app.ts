import express from 'express';
import { errorHandler } from './middleware/errorHandler.js';

export const app = express();

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(errorHandler);
