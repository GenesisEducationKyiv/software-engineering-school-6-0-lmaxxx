import type { SubscriberDirectory } from './ports/subscriber-directory.js';
import type { Mailer } from './ports/mailer.js';
import { RoutingKeys } from '../../shared/events.js';
import type {
  NotificationSendEvent,
  ReleasePublishedEvent,
  SubscriptionCreatedEvent,
  SagaEmailSendConfirmationEvent,
  EmailConfirmationSentEvent,
  EmailConfirmationFailedEvent,
} from '../../shared/events.js';
import type { EventBus } from '../../infra/messaging/index.js';

export type NotificationHandlers = {
  onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void>;
  onReleasePublished(event: ReleasePublishedEvent): Promise<void>;
  onNotificationSend(event: NotificationSendEvent): Promise<void>;
  onSagaEmailSendConfirmation(event: SagaEmailSendConfirmationEvent): Promise<void>;
  onEmailConfirmationSent(event: EmailConfirmationSentEvent): Promise<void>;
  onEmailConfirmationFailed(event: EmailConfirmationFailedEvent): Promise<void>;
};

export type SagaReplyHandler = {
  onEmailConfirmationSent(event: EmailConfirmationSentEvent): Promise<void>;
  onEmailConfirmationFailed(event: EmailConfirmationFailedEvent): Promise<void>;
};

export function createNotificationHandlers(deps: {
  subscribers: SubscriberDirectory;
  mailer: Mailer;
  bus: EventBus;
  sagaReplier?: SagaReplyHandler;
}): NotificationHandlers {
  const { subscribers, mailer, bus, sagaReplier } = deps;

  return {
    async onSubscriptionCreated(event) {
      await mailer.sendConfirmation(event.email, event.repo, event.confirmToken);
    },

    async onSagaEmailSendConfirmation(event) {
      try {
        await mailer.sendConfirmation(event.email, event.repo, event.confirmToken);
        await bus.publish(RoutingKeys.EmailConfirmationSent, {
          sagaId: event.sagaId,
          email: event.email,
          repo: event.repo,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await bus.publish(RoutingKeys.EmailConfirmationFailed, {
          sagaId: event.sagaId,
          email: event.email,
          repo: event.repo,
          error,
        });
      }
    },

    async onReleasePublished(event) {
      const recipients = await subscribers.confirmedSubscribers(event.repo);
      for (const sub of recipients) {
        await bus.publish(RoutingKeys.NotificationSend, {
          email: sub.email,
          repo: event.repo,
          tag: event.tag,
          unsubscribeToken: sub.unsubscribe_token,
        });
      }
    },

    async onNotificationSend(event) {
      await mailer.sendReleaseNotification(
        event.email,
        event.repo,
        event.tag,
        event.unsubscribeToken,
      );
    },

    async onEmailConfirmationSent(event) {
      await sagaReplier?.onEmailConfirmationSent(event);
    },

    async onEmailConfirmationFailed(event) {
      await sagaReplier?.onEmailConfirmationFailed(event);
    },
  };
}
