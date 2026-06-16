import type { SubscriberDirectory } from './ports/subscriber-directory.js';
import type { Mailer } from './ports/mailer.js';
import type {
  ReleasePublishedEvent,
  SubscriptionCreatedEvent,
} from '../../shared/events.js';

export type NotificationHandlers = {
  onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void>;
  onReleasePublished(event: ReleasePublishedEvent): Promise<void>;
};

export function createNotificationHandlers(deps: {
  subscribers: SubscriberDirectory;
  mailer: Mailer;
}): NotificationHandlers {
  const { subscribers, mailer } = deps;

  return {
    async onSubscriptionCreated(event) {
      await mailer.sendConfirmation(event.email, event.repo, event.confirmToken);
    },

    async onReleasePublished(event) {
      const recipients = await subscribers.confirmedSubscribers(event.repo);
      for (const sub of recipients) {
        await mailer.sendReleaseNotification(
          sub.email,
          event.repo,
          event.tag,
          sub.unsubscribe_token,
        );
      }
    },
  };
}
