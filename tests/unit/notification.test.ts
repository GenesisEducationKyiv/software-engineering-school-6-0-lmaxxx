import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoutingKeys } from '../../src/shared/events.js';
import {
  createNotificationHandlers,
  type NotificationHandlers,
} from '../../src/modules/notification/handlers.js';
import { startNotificationConsumer } from '../../src/modules/notification/consumer.js';
import type { SubscriberDirectory } from '../../src/modules/notification/ports/subscriber-directory.js';
import type { Mailer } from '../../src/modules/notification/ports/mailer.js';
import type { EventBus, IncomingEvent } from '../../src/infra/messaging/index.js';
import type { ConfirmedSubscriber } from '../../src/types.js';

function makeSub(overrides: Partial<ConfirmedSubscriber> = {}): ConfirmedSubscriber {
  return { email: 'user@example.com', unsubscribe_token: 'u-token', ...overrides };
}

let confirmedSubscribers: ReturnType<typeof vi.fn>;
let sendConfirmation: ReturnType<typeof vi.fn>;
let sendReleaseNotification: ReturnType<typeof vi.fn>;
let handlers: NotificationHandlers;

beforeEach(() => {
  vi.clearAllMocks();
  confirmedSubscribers = vi.fn();
  sendConfirmation = vi.fn();
  sendReleaseNotification = vi.fn();
  handlers = createNotificationHandlers({
    subscribers: { confirmedSubscribers } as unknown as SubscriberDirectory,
    mailer: { sendConfirmation, sendReleaseNotification } as unknown as Mailer,
  });
});

describe('onSubscriptionCreated', () => {
  it('sends a confirmation email for the event', async () => {
    sendConfirmation.mockResolvedValue(undefined);

    await handlers.onSubscriptionCreated({
      email: 'user@example.com',
      repo: 'owner/repo',
      confirmToken: 'confirm-123',
    });

    expect(sendConfirmation).toHaveBeenCalledWith('user@example.com', 'owner/repo', 'confirm-123');
  });
});

describe('onReleasePublished', () => {
  it('notifies every confirmed subscriber of the repo', async () => {
    confirmedSubscribers.mockResolvedValue([
      makeSub({ email: 'a@example.com', unsubscribe_token: 'u1' }),
      makeSub({ email: 'b@example.com', unsubscribe_token: 'u2' }),
    ]);
    sendReleaseNotification.mockResolvedValue(undefined);

    await handlers.onReleasePublished({ repo: 'owner/repo', tag: 'v2.0.0' });

    expect(confirmedSubscribers).toHaveBeenCalledWith('owner/repo');
    expect(sendReleaseNotification).toHaveBeenCalledTimes(2);
    expect(sendReleaseNotification).toHaveBeenCalledWith('a@example.com', 'owner/repo', 'v2.0.0', 'u1');
    expect(sendReleaseNotification).toHaveBeenCalledWith('b@example.com', 'owner/repo', 'v2.0.0', 'u2');
  });

  it('sends nothing when the repo has no confirmed subscribers', async () => {
    confirmedSubscribers.mockResolvedValue([]);

    await handlers.onReleasePublished({ repo: 'owner/repo', tag: 'v2.0.0' });

    expect(sendReleaseNotification).not.toHaveBeenCalled();
  });
});

describe('startNotificationConsumer', () => {
  it('binds the notification queue to both events and dispatches them to handlers', async () => {
    let captured: ((event: IncomingEvent) => Promise<void>) | undefined;
    const bus: EventBus = {
      publish: vi.fn(),
      close: vi.fn(),
      subscribe: vi.fn(async (_queue, _keys, handler) => {
        captured = handler;
      }),
    };

    await startNotificationConsumer(bus, handlers);

    expect(bus.subscribe).toHaveBeenCalledWith(
      'notification',
      [RoutingKeys.SubscriptionCreated, RoutingKeys.ReleasePublished],
      expect.any(Function),
    );

    sendConfirmation.mockResolvedValue(undefined);
    await captured!({
      routingKey: RoutingKeys.SubscriptionCreated,
      payload: { email: 'x@example.com', repo: 'owner/repo', confirmToken: 't' },
    });
    expect(sendConfirmation).toHaveBeenCalledWith('x@example.com', 'owner/repo', 't');
  });
});
