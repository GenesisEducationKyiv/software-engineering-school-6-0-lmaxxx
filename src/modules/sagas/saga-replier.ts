import type { SagaOrchestrator } from '../../infra/saga/types.js';
import type { SagaReplyHandler } from '../notification/handlers.js';
import type { EmailConfirmationSentEvent, EmailConfirmationFailedEvent } from '../../shared/events.js';

export function createSagaReplier(orchestrator: SagaOrchestrator): SagaReplyHandler {
  return {
    async onEmailConfirmationSent(event: EmailConfirmationSentEvent) {
      await orchestrator.completeStep(event.sagaId, 'sendEmail', {
        emailSent: true,
      });
    },

    async onEmailConfirmationFailed(event: EmailConfirmationFailedEvent) {
      await orchestrator.failStep(event.sagaId, 'sendEmail', event.error);
    },
  };
}
