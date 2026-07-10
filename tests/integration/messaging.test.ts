import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import amqp from 'amqplib';
import { RabbitMqBus } from '../../src/infra/messaging/rabbitmq-bus.js';
import { RoutingKeys } from '../../src/shared/events.js';
import type { EventBus, IncomingEvent } from '../../src/infra/messaging/index.js';

const URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';

function withTimeout<T>(p: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uniqueQueue = () => `it.${Date.now()}.${Math.random().toString(16).slice(2)}`;

function waiter<T = IncomingEvent>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Probe the broker once; skip the whole suite (rather than fail) if it's down.
let brokerDown = false;
try {
  const probe = await withTimeout(amqp.connect(URL), 3000);
  await probe.close();
} catch {
  brokerDown = true;
  console.warn(`[messaging.test] RabbitMQ not reachable at ${URL}; skipping integration suite`);
}

describe.skipIf(brokerDown)('RabbitMqBus (real broker)', () => {
  let bus: EventBus;
  const createdQueues: string[] = [];

  beforeAll(async () => {
    bus = await RabbitMqBus.connect(URL);
  });

  afterAll(async () => {
    // Delete the durable test queues so they don't accumulate on the broker.
    try {
      const conn = await amqp.connect(URL);
      const ch = await conn.createChannel();
      for (const q of createdQueues) {
        await ch.deleteQueue(q).catch(() => undefined);
      }
      await ch.close();
      await conn.close();
    } catch {
      /* best effort */
    }
    await bus.close().catch(() => undefined);
  });

  async function bindQueue(keys: (typeof RoutingKeys)[keyof typeof RoutingKeys][], handler: (e: IncomingEvent) => Promise<void>) {
    const queue = uniqueQueue();
    createdQueues.push(queue);
    await bus.subscribe(queue, keys, handler);
    return queue;
  }

  it('delivers a published event end-to-end through the exchange and queue', async () => {
    const w = waiter();
    await bindQueue([RoutingKeys.SubscriptionCreated], async (e) => w.resolve(e));

    const payload = { email: 'it@example.com', repo: 'owner/repo', confirmToken: 'tok-1' };
    await bus.publish(RoutingKeys.SubscriptionCreated, payload);

    const received = await withTimeout(w.promise, 5000, 'event never delivered');
    expect(received.routingKey).toBe(RoutingKeys.SubscriptionCreated);
    expect(received.payload).toEqual(payload);
  }, 15000);

  it('only delivers events whose routing key the queue is bound to', async () => {
    const received: IncomingEvent[] = [];
    await bindQueue([RoutingKeys.ReleasePublished], async (e) => {
      received.push(e);
    });

    // Not bound -> must NOT arrive; bound -> must arrive.
    await bus.publish(RoutingKeys.SubscriptionCreated, { email: 'a@b.co', repo: 'o/r', confirmToken: 't' });
    await bus.publish(RoutingKeys.ReleasePublished, { repo: 'o/r', tag: 'v9.9.9' });

    await withTimeout(
      (async () => {
        while (received.length < 1) await sleep(50);
      })(),
      5000,
      'bound event never delivered',
    );
    await sleep(300); // give any (wrongly) routed event a chance to show up

    expect(received).toHaveLength(1);
    expect(received[0].routingKey).toBe(RoutingKeys.ReleasePublished);
    expect(received[0].payload).toEqual({ repo: 'o/r', tag: 'v9.9.9' });
  }, 15000);

  it('requeues a failed message and redelivers it (at-least-once)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let attempts = 0;
    const done = waiter();

    await bindQueue([RoutingKeys.SubscriptionCreated], async (e) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('fail first delivery');
      }
      done.resolve(e);
    });

    await bus.publish(RoutingKeys.SubscriptionCreated, { email: 'rq@example.com', repo: 'o/r', confirmToken: 't' });

    await withTimeout(done.promise, 6000, 'message was not redelivered after failure');
    expect(attempts).toBeGreaterThanOrEqual(2);
    errSpy.mockRestore();
  }, 20000);
});