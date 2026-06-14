import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoutingKeys } from '../../src/shared/events.js';
import type { Subscription } from '../../src/types.js';

vi.mock('../../src/infra/mailer.js', () => ({
  sendConfirmationEmail: vi.fn(),
  sendReleaseNotification: vi.fn(),
}));

vi.mock('../../src/modules/subscription/index.js', () => ({
  getConfirmedSubscribers: vi.fn(),
}));

import { sendConfirmationEmail, sendReleaseNotification } from '../../src/infra/mailer.js';
import { getConfirmedSubscribers } from '../../src/modules/subscription/index.js';
import { onSubscriptionCreated, onReleasePublished } from '../../src/modules/notification/handlers.js';
import { startNotificationConsumer } from '../../src/modules/notification/index.js';
import type { EventBus, IncomingEvent } from '../../src/infra/messaging/index.js';

const mockSendConfirmation = vi.mocked(sendConfirmationEmail);
const mockSendRelease = vi.mocked(sendReleaseNotification);
const mockGetSubscribers = vi.mocked(getConfirmedSubscribers);

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    email: 'user@example.com',
    repo: 'owner/repo',
    confirmed: true,
    confirm_token: 'c-token',
    unsubscribe_token: 'u-token',
    created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('onSubscriptionCreated', () => {
  it('sends a confirmation email for the event', async () => {
    mockSendConfirmation.mockResolvedValue(undefined);

    await onSubscriptionCreated({
      email: 'user@example.com',
      repo: 'owner/repo',
      confirmToken: 'confirm-123',
    });

    expect(mockSendConfirmation).toHaveBeenCalledWith('user@example.com', 'owner/repo', 'confirm-123');
  });
});

describe('onReleasePublished', () => {
  it('notifies every confirmed subscriber of the repo', async () => {
    mockGetSubscribers.mockResolvedValue([
      makeSub({ email: 'a@example.com', unsubscribe_token: 'u1' }),
      makeSub({ email: 'b@example.com', unsubscribe_token: 'u2' }),
    ]);
    mockSendRelease.mockResolvedValue(undefined);

    await onReleasePublished({ repo: 'owner/repo', tag: 'v2.0.0' });

    expect(mockGetSubscribers).toHaveBeenCalledWith('owner/repo');
    expect(mockSendRelease).toHaveBeenCalledTimes(2);
    expect(mockSendRelease).toHaveBeenCalledWith('a@example.com', 'owner/repo', 'v2.0.0', 'u1');
    expect(mockSendRelease).toHaveBeenCalledWith('b@example.com', 'owner/repo', 'v2.0.0', 'u2');
  });

  it('sends nothing when the repo has no confirmed subscribers', async () => {
    mockGetSubscribers.mockResolvedValue([]);

    await onReleasePublished({ repo: 'owner/repo', tag: 'v2.0.0' });

    expect(mockSendRelease).not.toHaveBeenCalled();
  });
});

describe('startNotificationConsumer', () => {
  it('binds the notification queue to both domain events and dispatches them', async () => {
    let captured: ((event: IncomingEvent) => Promise<void>) | undefined;
    const bus: EventBus = {
      publish: vi.fn(),
      close: vi.fn(),
      subscribe: vi.fn(async (_queue, _keys, handler) => {
        captured = handler;
      }),
    };

    await startNotificationConsumer(bus);

    expect(bus.subscribe).toHaveBeenCalledWith(
      'notification',
      [RoutingKeys.SubscriptionCreated, RoutingKeys.ReleasePublished],
      expect.any(Function),
    );

    // The bound handler routes by routing key.
    mockSendConfirmation.mockResolvedValue(undefined);
    await captured!({
      routingKey: RoutingKeys.SubscriptionCreated,
      payload: { email: 'x@example.com', repo: 'owner/repo', confirmToken: 't' },
    });
    expect(mockSendConfirmation).toHaveBeenCalledWith('x@example.com', 'owner/repo', 't');
  });
});
