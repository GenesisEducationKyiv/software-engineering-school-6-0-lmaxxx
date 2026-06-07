import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../../../shared/appError.js';
import { EMAIL_REGEX } from '../../../validators/index.js';
import {
  createSubscription,
  confirmSubscription,
  unsubscribeUser,
  getSubscriptionsByEmail,
} from '../subscription.service.js';
import { upsertRepository } from '../../repository/index.js';

const router = Router();

router.post('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, repo } = req.body as { email?: unknown; repo?: unknown };
    if (typeof email !== 'string' || !email) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (typeof repo !== 'string' || !repo) {
      return res.status(400).json({ error: 'repo is required' });
    }
    await createSubscription(email, repo);
    await upsertRepository(repo);
    res.status(200).json({ message: 'Confirmation email sent' });
  } catch (err) {
    next(err);
  }
});

router.get('/confirm/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await confirmSubscription(req.params.token);
    res.status(200).json({ message: 'Subscription confirmed' });
  } catch (err) {
    next(err);
  }
});

router.get('/unsubscribe/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await unsubscribeUser(req.params.token);
    res.json({ message: 'Unsubscribed successfully' });
  } catch (err) {
    next(err);
  }
});

router.get('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.query;
    if (!email || typeof email !== 'string' || email.trim() === '') {
      throw new AppError(400, 'Missing or invalid email');
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      throw new AppError(400, 'Invalid email format');
    }
    const subscriptions = await getSubscriptionsByEmail(email.trim());
    res.json(subscriptions);
  } catch (err) {
    next(err);
  }
});

export default router;
