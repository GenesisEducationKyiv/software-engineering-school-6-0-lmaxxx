import { Router, Request, Response, NextFunction } from 'express';
import { getSubscriptionsByEmail } from '../services/subscription.js';
import { AppError } from '../shared/appError.js';
import { EMAIL_REGEX } from '../shared/validation.js';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
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
