import { Router } from 'express';
import { confirmSubscription } from '../services/subscription.js';

const router = Router();

router.get('/:token', async (req, res, next) => {
  try {
    await confirmSubscription(req.params.token);
    res.status(200).json({ message: 'Subscription confirmed' });
  } catch (err) {
    next(err);
  }
});

export default router;
