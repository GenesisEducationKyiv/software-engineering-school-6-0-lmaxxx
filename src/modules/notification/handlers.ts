import { sendConfirmationEmail, sendReleaseNotification } from '../../infra/mailer.js';
import { getConfirmedSubscribers } from '../subscription/index.js';
import type {
  ReleasePublishedEvent,
  SubscriptionCreatedEvent,
} from '../../shared/events.js';

/** A new (or re-issued) subscription needs a confirmation email. */
export async function onSubscriptionCreated(event: SubscriptionCreatedEvent): Promise<void> {
  await sendConfirmationEmail(event.email, event.repo, event.confirmToken);
}

/**
 * A repo published a new release. Look up its confirmed subscribers and notify
 * each one. Subscriber lookup goes through the subscription module's public API
 * so the event payload stays thin.
 */
export async function onReleasePublished(event: ReleasePublishedEvent): Promise<void> {
  const subscribers = await getConfirmedSubscribers(event.repo);
  for (const sub of subscribers) {
    await sendReleaseNotification(sub.email, event.repo, event.tag, sub.unsubscribe_token);
  }
}
