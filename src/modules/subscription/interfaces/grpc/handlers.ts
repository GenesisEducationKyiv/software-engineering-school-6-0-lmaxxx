import * as grpc from '@grpc/grpc-js';
import { AppError } from '../../../../shared/appError.js';
import { logger } from '../../../../logger.js';
import { grpcRequestsTotal, grpcRequestDurationSeconds } from '../../../../metrics.js';
import type { SubscriptionService } from '../../subscription.service.js';

function toGrpcStatus(httpStatus: number): grpc.status {
  switch (httpStatus) {
    case 400: return grpc.status.INVALID_ARGUMENT;
    case 404: return grpc.status.NOT_FOUND;
    case 409: return grpc.status.ALREADY_EXISTS;
    case 429: return grpc.status.RESOURCE_EXHAUSTED;
    default:  return grpc.status.INTERNAL;
  }
}

function handleError<T>(
  err: unknown,
  callback: grpc.sendUnaryData<T>,
  ctx: { method: string; email?: string },
): void {
  const grpcStatus = err instanceof AppError ? toGrpcStatus(err.status) : grpc.status.INTERNAL;
  logger.error(
    { err, method: ctx.method, email: ctx.email, grpcStatus: grpc.status[grpcStatus] },
    'gRPC handler error',
  );
  if (err instanceof AppError) {
    callback({ code: grpcStatus, message: err.message });
  } else {
    callback({
      code: grpc.status.INTERNAL,
      message: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

function withGrpcMetrics<Req, Res>(
  methodName: string,
  handler: (
    call: grpc.ServerUnaryCall<Req, Res>,
    callback: grpc.sendUnaryData<Res>,
  ) => Promise<void>,
) {
  return async (
    call: grpc.ServerUnaryCall<Req, Res>,
    callback: grpc.sendUnaryData<Res>,
  ): Promise<void> => {
    const end = grpcRequestDurationSeconds.startTimer();
    let statusLabel = 'OK';
    const wrappedCb: grpc.sendUnaryData<Res> = (err, value, ...rest) => {
      if (err) {
        const code = (err as grpc.ServiceError).code ?? grpc.status.INTERNAL;
        statusLabel = grpc.status[code] ?? 'UNKNOWN';
      }
      grpcRequestsTotal.inc({ method: methodName, status: statusLabel });
      end({ method: methodName, status: statusLabel });
      (callback as (...args: unknown[]) => void)(err, value, ...rest);
    };

    try {
      await handler(call, wrappedCb);
    } catch (err) {
      grpcRequestsTotal.inc({ method: methodName, status: 'INTERNAL' });
      end({ method: methodName, status: 'INTERNAL' });
      callback({
        code: grpc.status.INTERNAL,
        message: err instanceof Error ? err.message : 'Internal server error',
      });
    }
  };
}

interface SubscribeRequest   { email: string; repo: string }
interface TokenRequest       { token: string }
interface GetSubsRequest     { email: string }
interface MessageResponse    { message: string }
interface SubscriptionItem   {
  email: string; repo: string; confirmed: boolean; last_seen_tag: string;
}
interface GetSubsResponse    { subscriptions: SubscriptionItem[] }

/** Builds the gRPC service implementation around an injected subscription service. */
export function buildGrpcServiceImpl(service: SubscriptionService): grpc.UntypedServiceImplementation {
  async function subscribe(
    call: grpc.ServerUnaryCall<SubscribeRequest, MessageResponse>,
    callback: grpc.sendUnaryData<MessageResponse>,
  ): Promise<void> {
    const { email, repo } = call.request;
    try {
      await service.subscribe(email, repo);
      callback(null, { message: 'Confirmation email sent' });
    } catch (err) {
      handleError(err, callback, { method: 'Subscribe', email });
    }
  }

  async function confirmSubscriptionHandler(
    call: grpc.ServerUnaryCall<TokenRequest, MessageResponse>,
    callback: grpc.sendUnaryData<MessageResponse>,
  ): Promise<void> {
    const { token } = call.request;
    if (!token) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'token is required' });
    }
    try {
      await service.confirm(token);
      callback(null, { message: 'Subscription confirmed' });
    } catch (err) {
      handleError(err, callback, { method: 'ConfirmSubscription' });
    }
  }

  async function unsubscribeHandler(
    call: grpc.ServerUnaryCall<TokenRequest, MessageResponse>,
    callback: grpc.sendUnaryData<MessageResponse>,
  ): Promise<void> {
    const { token } = call.request;
    if (!token) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'token is required' });
    }
    try {
      await service.unsubscribe(token);
      callback(null, { message: 'Unsubscribed successfully' });
    } catch (err) {
      handleError(err, callback, { method: 'Unsubscribe' });
    }
  }

  async function getSubscriptionsHandler(
    call: grpc.ServerUnaryCall<GetSubsRequest, GetSubsResponse>,
    callback: grpc.sendUnaryData<GetSubsResponse>,
  ): Promise<void> {
    const { email } = call.request;
    try {
      const rows = await service.listByEmail(email.trim());
      const subscriptions: SubscriptionItem[] = rows.map((s) => ({
        email:         s.email,
        repo:          s.repo,
        confirmed:     s.confirmed,
        last_seen_tag: s.last_seen_tag ?? '',
      }));
      callback(null, { subscriptions });
    } catch (err) {
      handleError(err, callback, { method: 'GetSubscriptions', email });
    }
  }

  return {
    subscribe:            withGrpcMetrics('Subscribe', subscribe),
    confirmSubscription:  withGrpcMetrics('ConfirmSubscription', confirmSubscriptionHandler),
    unsubscribe:          withGrpcMetrics('Unsubscribe', unsubscribeHandler),
    getSubscriptions:     withGrpcMetrics('GetSubscriptions', getSubscriptionsHandler),
  };
}
