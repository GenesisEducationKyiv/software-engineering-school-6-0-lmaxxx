import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../shared/appError.js';
import { checkRepoExists } from './github.js';
import { sendConfirmationEmail } from './email.js';
import {
  findByEmailAndRepo,
  findByConfirmToken,
  insertSubscription,
  markConfirmed,
  updateConfirmToken,
} from '../db/subscriptions.js';
import { upsertRepository } from '../db/repositories.js';

export { AppError };

const REPO_REGEX = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export function validateRepoFormat(repo: string): boolean {
  return REPO_REGEX.test(repo);
}

export async function createSubscription(email: string, repo: string): Promise<void> {
  if (!validateRepoFormat(repo)) {
    throw new AppError(400, 'Invalid repo format — expected owner/repo');
  }

  await checkRepoExists(repo);

  const existing = await findByEmailAndRepo(email, repo);

  if (existing) {
    if (existing.confirmed) {
      throw new AppError(409, 'Already subscribed to this repository');
    }
    // Not confirmed — resend confirmation with a fresh token
    const newToken = uuidv4();
    await updateConfirmToken(existing.id, newToken);
    await sendConfirmationEmail(email, repo, newToken);
    return;
  }

  const confirmToken = uuidv4();
  const unsubscribeToken = uuidv4();

  await insertSubscription(email, repo, confirmToken, unsubscribeToken);
  await upsertRepository(repo);
  await sendConfirmationEmail(email, repo, confirmToken);
}

export async function confirmSubscription(token: string): Promise<void> {
  const sub = await findByConfirmToken(token);
  if (!sub) {
    throw new AppError(404, 'Confirmation token not found');
  }
  if (sub.confirmed) {
    throw new AppError(400, 'Subscription already confirmed');
  }
  await markConfirmed(sub.id);
}
