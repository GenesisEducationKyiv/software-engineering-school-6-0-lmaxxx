import type { SubscriberDirectory } from './ports/subscriber-directory.js';
import type { Mailer } from './ports/mailer.js';
import { RoutingKeys } from '../../shared/events.js';
import type {
  NotificationSendEvent,
  ReleasePublishedEvent,
  SubscriptionCreatedEvent,
} from '../../shared/events.js';
import type { EventBus } from '../../infra/messaging/index.js';

export type NotificationHandlers = {
  onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void>;
  onReleasePublished(event: ReleasePublishedEvent): Promise<void>;
  onNotificationSend(event: NotificationSendEvent): Promise<void>;
};

export function createNotificationHandlers(deps: {
  subscribers: SubscriberDirectory;
  mailer: Mailer;
  bus: EventBus;
}): NotificationHandlers {
  const { subscribers, mailer, bus } = deps;

  return {
    async onSubscriptionCreated(event) {
      await mailer.sendConfirmation(event.email, event.repo, event.confirmToken);
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
  };
}
