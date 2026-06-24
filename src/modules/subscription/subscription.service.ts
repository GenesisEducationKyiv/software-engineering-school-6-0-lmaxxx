import { AppError } from '../../shared/appError.js';
import { Email } from '../../shared/domain/email.js';
import { RepoSlug } from '../../shared/domain/repo-slug.js';
import { Token } from './domain/token.js';
import { parseOrThrow } from '../../shared/domain/parse.js';
import {
  type Subscription,
  createSubscription,
  reissueConfirmation,
  confirm as confirmSubscription,
} from './domain/subscription.js';
import { RoutingKeys } from '../../shared/events.js';
import { REPO_REGEX } from '../../validators/index.js';
import type { RepositoryChecker } from './ports/repository-checker.js';
import type { RepositoryRegistrar } from './ports/repository-registrar.js';
import type { EventBus } from '../../infra/messaging/index.js';
import {
  findByEmailAndRepo,
  findByConfirmToken,
  findByUnsubscribeToken,
  save,
  deleteSubscription,
  findConfirmedByEmail,
} from './subscription.repository.js';
import type { SubscriptionResponse } from '../../types.js';

export { AppError };

export function validateRepoFormat(repo: string): boolean {
  return REPO_REGEX.test(repo);
}

export type SubscriptionService = {
  subscribe(email: string, repo: string): Promise<void>;
  confirm(token: string): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  listByEmail(email: string): Promise<SubscriptionResponse[]>;
  reserve(email: string, repo: string): Promise<{
    subscriptionId: number;
    confirmToken: Token;
    unsubscribeToken: Token;
  }>;
  cancel(subscriptionId: number): Promise<void>;
};

export function createSubscriptionService(deps: {
  repoChecker: RepositoryChecker;
  registrar: RepositoryRegistrar;
  bus: EventBus;
}): SubscriptionService {
  const { repoChecker, registrar, bus } = deps;

  function publishCreated(sub: Subscription): Promise<void> {
    return bus.publish(RoutingKeys.SubscriptionCreated, {
      email: sub.email,
      repo: sub.repo,
      confirmToken: sub.confirmToken!,
    });
  }

  function doReserve(emailInput: string, repoInput: string) {
    const email = parseOrThrow(Email, emailInput);
    const repo = parseOrThrow(RepoSlug, repoInput);
    return { email, repo };
  }

  return {
    async subscribe(emailInput, repoInput) {
      const { email, repo } = doReserve(emailInput, repoInput);

      await repoChecker.ensureExists(repo);

      const existing = await findByEmailAndRepo(email, repo);
      const sub = existing ? reissueConfirmation(existing) : createSubscription(email, repo);
      await save(sub);
      await registrar.ensureTracked(repo);
      await publishCreated(sub);
    },

    async reserve(emailInput, repoInput) {
      const { email, repo } = doReserve(emailInput, repoInput);

      await repoChecker.ensureExists(repo);

      const existing = await findByEmailAndRepo(email, repo);
      const sub = existing ? reissueConfirmation(existing) : createSubscription(email, repo);
      const newId = await save(sub);
      const subscriptionId = existing ? existing.id! : newId!;
      await registrar.ensureTracked(repo);

      return { subscriptionId, confirmToken: sub.confirmToken!, unsubscribeToken: sub.unsubscribeToken };
    },

    async cancel(subscriptionId) {
      await deleteSubscription(subscriptionId);
    },

    async confirm(token) {
      const existing = await findByConfirmToken(token);
      if (!existing) {
        throw new AppError(404, 'Confirmation token not found');
      }
      await save(confirmSubscription(existing));
    },

    async unsubscribe(token) {
      parseOrThrow(Token, token);
      const existing = await findByUnsubscribeToken(token);
      if (!existing) {
        throw new AppError(404, 'Token not found');
      }
      await deleteSubscription(existing.id!);
    },

    listByEmail(email) {
      return findConfirmedByEmail(email);
    },
  };
}
