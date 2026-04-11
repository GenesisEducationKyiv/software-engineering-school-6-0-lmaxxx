import { Router } from 'express';
import { unsubscribeUser } from '../services/subscription.js';

const router = Router();

router.get('/:token', async (req, res, next) => {
  try {
    await unsubscribeUser(req.params.token);
    res.json({ message: 'Unsubscribed successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
