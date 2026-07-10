import amqp from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';
import { EXCHANGE, type EventPayloads, type RoutingKey } from '../../shared/events.js';
import type { EventBus, EventHandler, IncomingEvent } from './types.js';

/**
 * RabbitMQ-backed EventBus. Uses a single topic exchange (`domain.events`);
 * consumers bind a durable queue with the routing keys they care about and ack
 * each message after the handler succeeds (at-least-once delivery).
 */
export class RabbitMqBus implements EventBus {
  private constructor(
    private readonly connection: ChannelModel,
    private readonly channel: Channel,
  ) {}

  static async connect(url: string): Promise<RabbitMqBus> {
    const connection = await amqp.connect(url);
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    console.log('Connected to RabbitMQ');
    return new RabbitMqBus(connection, channel);
  }

  publish<K extends RoutingKey>(routingKey: K, payload: EventPayloads[K]): Promise<void> {
    const content = Buffer.from(JSON.stringify(payload));
    this.channel.publish(EXCHANGE, routingKey, content, { persistent: true });
    return Promise.resolve();
  }

  async subscribe(queue: string, routingKeys: RoutingKey[], handler: EventHandler): Promise<void> {
    await this.channel.assertQueue(queue, { durable: true });
    for (const key of routingKeys) {
      await this.channel.bindQueue(queue, EXCHANGE, key);
    }
    await this.channel.consume(queue, (msg) => {
      if (!msg) return;
      const routingKey = String(msg.fields.routingKey) as RoutingKey;
      const payload = JSON.parse(msg.content.toString()) as unknown;
      handler({ routingKey, payload } as IncomingEvent)
        .then(() => this.channel.ack(msg))
        .catch((err) => {
          console.error(`Failed handling ${routingKey}, requeueing:`, err);
          this.channel.nack(msg, false, true);
        });
    });
    console.log(`Subscribed queue "${queue}" to [${routingKeys.join(', ')}]`);
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
