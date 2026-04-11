import { Router, Request, Response, NextFunction } from 'express';
import { findConfirmedByEmail } from '../db/subscriptions.js';
import { AppError } from '../shared/appError.js';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.query;
    if (!email || typeof email !== 'string' || email.trim() === '') {
      throw new AppError('Missing or invalid email', 400);
    }
    const subscriptions = await findConfirmedByEmail(email.trim());
    res.json(subscriptions);
  } catch (err) {
    next(err);
  }
});

export default router;
