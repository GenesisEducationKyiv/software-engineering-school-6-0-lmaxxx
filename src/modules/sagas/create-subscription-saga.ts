import type { SagaDefinition, SagaContext } from '../../infra/saga/types.js';
import type { SubscriptionService } from '../subscription/subscription.service.js';

export const CREATE_SUBSCRIPTION_SAGA_TYPE = 'CREATE_SUBSCRIPTION';

/**
 * Builds the create-subscription saga around the injected SubscriptionService.
 * The reserve/compensate steps delegate to the service so they share the same
 * validation, repo tracking, and id handling as the non-saga subscribe path.
 */
export function createCreateSubscriptionSaga(
  service: SubscriptionService,
): SagaDefinition {
  return {
    type: CREATE_SUBSCRIPTION_SAGA_TYPE,
    version: 1,
    steps: [
      {
        name: 'reserve',
        type: 'LOCAL',
        async action(ctx: SagaContext) {
          const r = await service.reserve(
            ctx.state.email as string,
            ctx.state.repo as string,
          );
          return {
            subscriptionId: r.subscriptionId,
            confirmToken: r.confirmToken,
            unsubscribeToken: r.unsubscribeToken,
            created: r.created,
          };
        },
        async compensate(ctx: SagaContext) {
          // Only roll back a subscription this saga actually created; a
          // pre-existing pending row must survive a failed confirmation.
          if (ctx.state.created === true && typeof ctx.state.subscriptionId === 'number') {
            await service.cancel(ctx.state.subscriptionId);
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
        action(_ctx: SagaContext) {
          return Promise.resolve({});
        },
        async compensate(ctx: SagaContext) {
          if (ctx.state.created === true && typeof ctx.state.subscriptionId === 'number') {
            await service.cancel(ctx.state.subscriptionId);
          }
        },
      },
    ],
  };
}
