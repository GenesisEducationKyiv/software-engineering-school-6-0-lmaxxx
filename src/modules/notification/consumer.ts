import { RoutingKeys } from '../../shared/events.js';
import type { EventBus, IncomingEvent } from '../../infra/messaging/index.js';
import type { NotificationHandlers } from './handlers.js';

const QUEUE = 'notification';

export async function startNotificationConsumer(
  bus: EventBus,
  handlers: NotificationHandlers,
): Promise<void> {
  const dispatch = async (event: IncomingEvent): Promise<void> => {
    switch (event.routingKey) {
      case RoutingKeys.SubscriptionCreated:
        return handlers.onSubscriptionCreated(event.payload);
      case RoutingKeys.ReleasePublished:
        return handlers.onReleasePublished(event.payload);
      case RoutingKeys.NotificationSend:
        return handlers.onNotificationSend(event.payload);
      default: {
        const { routingKey } = event as IncomingEvent;
        console.warn(`Notification consumer received unknown event: ${routingKey}`);
      }
    }
  };

  await bus.subscribe(
    QUEUE,
    [
      RoutingKeys.SubscriptionCreated,
      RoutingKeys.ReleasePublished,
      RoutingKeys.NotificationSend,
    ],
    dispatch,
  );
}
