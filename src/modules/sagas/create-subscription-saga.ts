import type { SagaDefinition, SagaContext } from '../../infra/saga/types.js';
import { registerDefinition } from './registry.js';
import * as subscriptionRepo from '../subscription/subscription.repository.js';
import { createSubscription, reissueConfirmation } from '../subscription/domain/subscription.js';
import { Email } from '../../shared/domain/email.js';
import { RepoSlug } from '../../shared/domain/repo-slug.js';
import { parseOrThrow } from '../../shared/domain/parse.js';

export const CREATE_SUBSCRIPTION_SAGA_TYPE = 'CREATE_SUBSCRIPTION';

export const createSubscriptionSaga: SagaDefinition = {
  type: CREATE_SUBSCRIPTION_SAGA_TYPE,
  version: 1,
  steps: [
    {
      name: 'reserve',
      type: 'LOCAL',
      async action(ctx: SagaContext) {
        const email = parseOrThrow(Email, ctx.state.email as string);
        const repo = parseOrThrow(RepoSlug, ctx.state.repo as string);

        const existing = await subscriptionRepo.findByEmailAndRepo(email, repo);
        const sub = existing
          ? reissueConfirmation(existing)
          : createSubscription(email, repo);

        const id = await subscriptionRepo.save(sub);
        return {
          subscriptionId: id,
          confirmToken: sub.confirmToken,
          unsubscribeToken: sub.unsubscribeToken,
        };
      },
      async compensate(ctx: SagaContext) {
        const subId = ctx.state.subscriptionId;
        if (typeof subId === 'number') {
          await subscriptionRepo.deleteSubscription(subId);
        }
      },
    },
    {
      name: 'sendEmail',
      type: 'ACTION',
      commandRoutingKey: 'saga.email.send_confirmation',
      action(_ctx: SagaContext) {
        return Promise.resolve({});
      },
      compensate(_ctx: SagaContext) {
        console.warn(`Saga ${_ctx.sagaId}: email already sent, no compensation`);
        return Promise.resolve();
      },
    },
    {
      name: 'waitConfirmation',
      type: 'WAIT',
      timeoutMs: 24 * 60 * 60 * 1000,
      async action(ctx: SagaContext) {
        const subId = ctx.state.subscriptionId;
        if (typeof subId !== 'number') {
          throw new Error('Missing subscriptionId in saga state');
        }
        const sub = await subscriptionRepo.findById(subId);
        if (sub && sub.confirmed) {
          return { confirmed: true };
        }
        return {};
      },
      async compensate(ctx: SagaContext) {
        const subId = ctx.state.subscriptionId;
        if (typeof subId === 'number') {
          await subscriptionRepo.deleteSubscription(subId);
        }
      },
    },
  ],
};

registerDefinition(createSubscriptionSaga);
