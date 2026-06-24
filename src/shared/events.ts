/**
 * Domain event contracts shared across modules.
 *
 * Events are published to the `domain.events` topic exchange and consumed by
 * the notification module. Routing keys identify the event type.
 */

export const EXCHANGE = 'domain.events';

export const RoutingKeys = {
  SubscriptionCreated: 'subscription.created',
  ReleasePublished: 'release.published',
  NotificationSend: 'notification.send',
  SagaEmailSendConfirmation: 'saga.email.send_confirmation',
  EmailConfirmationSent: 'email.confirmation.sent',
  EmailConfirmationFailed: 'email.confirmation.failed',
} as const;

export type RoutingKey = (typeof RoutingKeys)[keyof typeof RoutingKeys];

export interface SubscriptionCreatedEvent {
  email: string;
  repo: string;
  confirmToken: string;
}

export interface ReleasePublishedEvent {
  repo: string;
  tag: string;
}

export interface NotificationSendEvent {
  email: string;
  repo: string;
  tag: string;
  unsubscribeToken: string;
}

export interface SagaEmailSendConfirmationEvent {
  sagaId: string;
  email: string;
  repo: string;
  confirmToken: string;
}

export interface EmailConfirmationSentEvent {
  sagaId: string;
  email: string;
  repo: string;
}

export interface EmailConfirmationFailedEvent {
  sagaId: string;
  email: string;
  repo: string;
  error: string;
}

/** Maps each routing key to its payload type. */
export interface EventPayloads {
  [RoutingKeys.SubscriptionCreated]: SubscriptionCreatedEvent;
  [RoutingKeys.ReleasePublished]: ReleasePublishedEvent;
  [RoutingKeys.NotificationSend]: NotificationSendEvent;
  [RoutingKeys.SagaEmailSendConfirmation]: SagaEmailSendConfirmationEvent;
  [RoutingKeys.EmailConfirmationSent]: EmailConfirmationSentEvent;
  [RoutingKeys.EmailConfirmationFailed]: EmailConfirmationFailedEvent;
}
