import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../shared/appError.js';
import { checkRepoExists } from '../github/index.js';
import { sendConfirmationEmail } from '../../infra/mailer.js';
import {
  findByEmailAndRepo,
  findByConfirmToken,
  findByUnsubscribeToken,
  insertSubscription,
  markConfirmed,
  updateConfirmToken,
  deleteSubscription,
  findConfirmedByEmail,
} from './subscription.repository.js';
import { REPO_REGEX, UUID_REGEX } from '../../validators/index.js';
import { logger } from '../../logger.js';
import type { SubscriptionResponse } from '../../types.js';


export { AppError };

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
    const newToken = uuidv4();
    await updateConfirmToken(existing.id, newToken);
    await sendConfirmationEmail(email, repo, newToken);
    logger.info({ email, repo }, 'Resent confirmation email for existing unconfirmed subscription');
    return;
  }

  const confirmToken = uuidv4();
  const unsubscribeToken = uuidv4();

  await insertSubscription(email, repo, confirmToken, unsubscribeToken);
  await sendConfirmationEmail(email, repo, confirmToken);
  logger.info({ email, repo }, 'New subscription created');
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
  logger.info({ token }, 'Subscription confirmed');
}

export async function unsubscribeUser(token: string): Promise<void> {
  if (!UUID_REGEX.test(token)) {
    throw new AppError(400, 'Invalid token');
  }
  const sub = await findByUnsubscribeToken(token);
  if (!sub) {
    throw new AppError(404, 'Token not found');
  }
  await deleteSubscription(sub.id);
  logger.info({ token }, 'User unsubscribed');
}

export async function getSubscriptionsByEmail(email: string): Promise<SubscriptionResponse[]> {
  return findConfirmedByEmail(email);
}
