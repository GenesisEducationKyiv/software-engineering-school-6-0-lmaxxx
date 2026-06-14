import { config } from '../../config.js';
import { RabbitMqBus } from './rabbitmq-bus.js';
import type { EventBus } from './types.js';

export type { EventBus, EventHandler, IncomingEvent } from './types.js';

let bus: EventBus | null = null;

/** Establishes the broker connection. Call once during startup. */
export async function connectBus(): Promise<EventBus> {
  bus = await RabbitMqBus.connect(config.rabbitmqUrl);
  return bus;
}

/** Returns the connected bus. Throws if accessed before connectBus(). */
export function getBus(): EventBus {
  if (!bus) {
    throw new Error('Event bus not connected — call connectBus() during startup');
  }
  return bus;
}

/** Test seam: inject a fake bus without a real broker. */
export function setBus(fake: EventBus): void {
  bus = fake;
}
