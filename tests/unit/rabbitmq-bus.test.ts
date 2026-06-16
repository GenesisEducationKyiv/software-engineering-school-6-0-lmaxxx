import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RabbitMqBus } from '../../src/infra/messaging/rabbitmq-bus.js';
import { EXCHANGE, RoutingKeys } from '../../src/shared/events.js';
import type { EventHandler } from '../../src/infra/messaging/index.js';

const h = vi.hoisted(() => {
  const channel = {
    assertExchange: vi.fn(),
    assertQueue: vi.fn(),
    bindQueue: vi.fn(),
    consume: vi.fn(),
    publish: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn(),
  };
  const connection = { createChannel: vi.fn(), close: vi.fn() };
  const connect = vi.fn();
  return { channel, connection, connect };
});

vi.mock('amqplib', () => ({ default: { connect: h.connect } }));

/** Let the consume callback's `.then(ack)` / `.catch(nack)` chain settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The message callback the bus registers via channel.consume. */
let consumeCb: (msg: unknown) => void;

function fakeMsg(routingKey: string, payload: unknown) {
  return {
    fields: { routingKey },
    content: Buffer.from(JSON.stringify(payload)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.channel.assertExchange.mockResolvedValue(undefined);
  h.channel.assertQueue.mockResolvedValue(undefined);
  h.channel.bindQueue.mockResolvedValue(undefined);
  h.channel.close.mockResolvedValue(undefined);
  h.channel.consume.mockImplementation((_queue: string, cb: (msg: unknown) => void) => {
    consumeCb = cb;
    return Promise.resolve(undefined);
  });
  h.connection.createChannel.mockResolvedValue(h.channel);
  h.connection.close.mockResolvedValue(undefined);
  h.connect.mockResolvedValue(h.connection);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

async function connectBus(): Promise<RabbitMqBus> {
  return RabbitMqBus.connect('amqp://test');
}

describe('RabbitMqBus.connect', () => {
  it('asserts the durable topic exchange', async () => {
    await connectBus();
    expect(h.connect).toHaveBeenCalledWith('amqp://test');
    expect(h.channel.assertExchange).toHaveBeenCalledWith(EXCHANGE, 'topic', { durable: true });
  });
});

describe('RabbitMqBus.subscribe', () => {
  it('asserts a durable queue and binds it once per routing key', async () => {
    const bus = await connectBus();

    await bus.subscribe(
      'notification',
      [RoutingKeys.SubscriptionCreated, RoutingKeys.ReleasePublished],
      vi.fn() as unknown as EventHandler,
    );

    expect(h.channel.assertQueue).toHaveBeenCalledWith('notification', { durable: true });
    expect(h.channel.bindQueue).toHaveBeenCalledTimes(2);
    expect(h.channel.bindQueue).toHaveBeenCalledWith('notification', EXCHANGE, RoutingKeys.SubscriptionCreated);
    expect(h.channel.bindQueue).toHaveBeenCalledWith('notification', EXCHANGE, RoutingKeys.ReleasePublished);
  });

  it('passes the parsed event to the handler and acks on success', async () => {
    const bus = await connectBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    await bus.subscribe('notification', [RoutingKeys.SubscriptionCreated], handler as unknown as EventHandler);

    const payload = { email: 'a@b.co', repo: 'owner/repo', confirmToken: 't' };
    const msg = fakeMsg(RoutingKeys.SubscriptionCreated, payload);
    consumeCb(msg);
    await flush();

    expect(handler).toHaveBeenCalledWith({ routingKey: RoutingKeys.SubscriptionCreated, payload });
    expect(h.channel.ack).toHaveBeenCalledWith(msg);
    expect(h.channel.nack).not.toHaveBeenCalled();
  });

  it('nacks with requeue and logs when the handler throws', async () => {
    const bus = await connectBus();
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bus.subscribe('notification', [RoutingKeys.SubscriptionCreated], handler as unknown as EventHandler);

    const msg = fakeMsg(RoutingKeys.SubscriptionCreated, { email: 'a@b.co', repo: 'owner/repo', confirmToken: 't' });
    consumeCb(msg);
    await flush();

    expect(h.channel.nack).toHaveBeenCalledWith(msg, false, true);
    expect(h.channel.ack).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('ignores a null message (no handler, no ack/nack)', async () => {
    const bus = await connectBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    await bus.subscribe('notification', [RoutingKeys.SubscriptionCreated], handler as unknown as EventHandler);

    consumeCb(null);
    await flush();

    expect(handler).not.toHaveBeenCalled();
    expect(h.channel.ack).not.toHaveBeenCalled();
    expect(h.channel.nack).not.toHaveBeenCalled();
  });
});

describe('RabbitMqBus.publish', () => {
  it('publishes a persistent JSON message to the exchange with the routing key', async () => {
    const bus = await connectBus();
    const payload = { email: 'a@b.co', repo: 'owner/repo', confirmToken: 't' };

    await bus.publish(RoutingKeys.SubscriptionCreated, payload);

    expect(h.channel.publish).toHaveBeenCalledWith(
      EXCHANGE,
      RoutingKeys.SubscriptionCreated,
      expect.any(Buffer),
      { persistent: true },
    );
    const body = h.channel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(body.toString())).toEqual(payload);
  });
});

describe('RabbitMqBus.close', () => {
  it('closes the channel then the connection', async () => {
    const bus = await connectBus();
    await bus.close();
    expect(h.channel.close).toHaveBeenCalled();
    expect(h.connection.close).toHaveBeenCalled();
  });
});