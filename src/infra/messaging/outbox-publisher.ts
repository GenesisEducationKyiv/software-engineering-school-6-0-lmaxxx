import { pollOutbox, markOutboxSent, markOutboxFailed } from '../saga/outbox.repository.js';
import type { EventBus } from '../messaging/types.js';

export function startOutboxPublisher(bus: EventBus, intervalMs = 1000): { stop: () => void } {
  const interval = setInterval(async () => {
    try {
      const entries = await pollOutbox(50);
      for (const entry of entries) {
        try {
          await bus.publish(entry.routingKey, entry.payload);
          await markOutboxSent(entry.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Outbox publish failed for entry ${entry.id}: ${message}`);
          await markOutboxFailed(entry.id, message);
        }
      }
    } catch (err) {
      console.error('Outbox poll cycle failed:', err);
    }
  }, intervalMs);

  return { stop: () => clearInterval(interval) };
}
