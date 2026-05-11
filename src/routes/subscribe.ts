import { Router } from 'express';
import { createSubscription } from '../services/subscription.js';
import { EMAIL_REGEX } from '../shared/validation.js';

const router = Router();

router.post('/', async (req, res, next) => {
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
    res.status(200).json({ message: 'Confirmation email sent' });
  } catch (err) {
    next(err);
  }
});

export default router;
