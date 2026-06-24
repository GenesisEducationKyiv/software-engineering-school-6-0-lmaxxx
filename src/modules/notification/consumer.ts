import { RoutingKeys } from '../../shared/events.js';
import type { EventBus, IncomingEvent } from '../../infra/messaging/index.js';
import { onSubscriptionCreated, onReleasePublished } from './handlers.js';

const QUEUE = 'notification';

/** Routes an incoming event to the matching handler. */
async function dispatch(event: IncomingEvent): Promise<void> {
  switch (event.routingKey) {
    case RoutingKeys.SubscriptionCreated:
      return onSubscriptionCreated(event.payload);
    case RoutingKeys.ReleasePublished:
      return onReleasePublished(event.payload);
    default: {
      // Unreachable for known keys; guards against an unexpected routing key at runtime.
      const { routingKey } = event as IncomingEvent;
      console.warn(`Notification consumer received unknown event: ${routingKey}`);
    }
  }
}

/** Binds the notification queue to the domain events it cares about. */
export async function startNotificationConsumer(bus: EventBus): Promise<void> {
  await bus.subscribe(
    QUEUE,
    [RoutingKeys.SubscriptionCreated, RoutingKeys.ReleasePublished],
    dispatch,
  );
}
