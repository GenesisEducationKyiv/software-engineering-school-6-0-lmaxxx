import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNotificationHandlers,
  type NotificationHandlers,
} from '../../src/modules/notification/handlers.js';
import { RoutingKeys } from '../../src/shared/events.js';
import type { SubscriberDirectory } from '../../src/modules/notification/ports/subscriber-directory.js';
import type { Mailer } from '../../src/modules/notification/ports/mailer.js';
import type { EventBus } from '../../src/infra/messaging/index.js';

let confirmedSubscribers: ReturnType<typeof vi.fn>;
let sendConfirmation: ReturnType<typeof vi.fn>;
let sendReleaseNotification: ReturnType<typeof vi.fn>;
let publish: ReturnType<typeof vi.fn>;
let handlers: NotificationHandlers;

beforeEach(() => {
  vi.clearAllMocks();
  confirmedSubscribers = vi.fn();
  sendConfirmation = vi.fn().mockResolvedValue(undefined);
  sendReleaseNotification = vi.fn().mockResolvedValue(undefined);
  publish = vi.fn().mockResolvedValue(undefined);
  handlers = createNotificationHandlers({
    subscribers: { confirmedSubscribers } as unknown as SubscriberDirectory,
    mailer: { sendConfirmation, sendReleaseNotification } as unknown as Mailer,
    bus: { publish } as unknown as EventBus,
  });
});

describe('onSubscriptionCreated', () => {
  it('sends exactly one confirmation email', async () => {
    await handlers.onSubscriptionCreated({
      email: 'a@b.co',
      repo: 'owner/repo',
      confirmToken: 'tok',
    });
    expect(sendConfirmation).toHaveBeenCalledWith('a@b.co', 'owner/repo', 'tok');
  });
});

describe('onReleasePublished (fan-out)', () => {
  it('publishes one notification.send per subscriber and sends no mail directly', async () => {
    confirmedSubscribers.mockResolvedValue([
      { email: 'a@b.co', unsubscribe_token: 'u1' },
      { email: 'c@d.co', unsubscribe_token: 'u2' },
    ]);

    await handlers.onReleasePublished({ repo: 'owner/repo', tag: 'v1.1.0' });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(RoutingKeys.NotificationSend, {
      email: 'a@b.co',
      repo: 'owner/repo',
      tag: 'v1.1.0',
      unsubscribeToken: 'u1',
    });
    expect(publish).toHaveBeenCalledWith(RoutingKeys.NotificationSend, {
      email: 'c@d.co',
      repo: 'owner/repo',
      tag: 'v1.1.0',
      unsubscribeToken: 'u2',
    });
    expect(sendReleaseNotification).not.toHaveBeenCalled();
  });

  it('publishes nothing when there are no confirmed subscribers', async () => {
    confirmedSubscribers.mockResolvedValue([]);
    await handlers.onReleasePublished({ repo: 'owner/repo', tag: 'v1.1.0' });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('onNotificationSend', () => {
  it('sends exactly one release email', async () => {
    await handlers.onNotificationSend({
      email: 'a@b.co',
      repo: 'owner/repo',
      tag: 'v1.1.0',
      unsubscribeToken: 'u1',
    });
    expect(sendReleaseNotification).toHaveBeenCalledOnce();
    expect(sendReleaseNotification).toHaveBeenCalledWith('a@b.co', 'owner/repo', 'v1.1.0', 'u1');
  });

  it('propagates a send failure so the bus can nack only that recipient', async () => {
    sendReleaseNotification.mockRejectedValue(new Error('smtp down'));
    await expect(
      handlers.onNotificationSend({
        email: 'a@b.co',
        repo: 'owner/repo',
        tag: 'v1.1.0',
        unsubscribeToken: 'u1',
      }),
    ).rejects.toThrow('smtp down');
  });
});
