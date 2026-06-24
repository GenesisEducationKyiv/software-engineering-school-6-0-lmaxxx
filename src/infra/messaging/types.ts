import type { EventPayloads, RoutingKey } from '../../shared/events.js';

/**
 * Discriminated union over routing keys, so a `switch (event.routingKey)`
 * narrows `event.payload` to the matching event type.
 */
export type IncomingEvent = {
  [K in RoutingKey]: { routingKey: K; payload: EventPayloads[K] };
}[RoutingKey];

/** Handler returns void on success; throwing causes the message to be requeued. */
export type EventHandler = (event: IncomingEvent) => Promise<void>;

/**
 * Abstraction over the message broker so publishers/consumers don't depend on
 * amqplib directly and can be mocked in tests.
 */
export interface EventBus {
  publish<K extends RoutingKey>(routingKey: K, payload: EventPayloads[K]): Promise<void>;
  subscribe(queue: string, routingKeys: RoutingKey[], handler: EventHandler): Promise<void>;
  close(): Promise<void>;
}
