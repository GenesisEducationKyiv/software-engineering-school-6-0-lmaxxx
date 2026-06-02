import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createSubscription, confirmSubscription, unsubscribeUser, getSubscriptionsByEmail } from '../services/subscription.js';
import { AppError } from '../shared/appError.js';
import { logger } from '../logger.js';
import { grpcRequestsTotal, grpcRequestDurationSeconds } from '../metrics.js';
import { EMAIL_REGEX } from '../shared/validation.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTO_PATH = join(__dirname, '..', '..', 'proto', 'github_notifier.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
  github_notifier: {
    GitHubNotifier: grpc.ServiceClientConstructor;
  };
};


function toGrpcStatus(httpStatus: number): grpc.status {
  switch (httpStatus) {
    case 400: return grpc.status.INVALID_ARGUMENT;
    case 404: return grpc.status.NOT_FOUND;
    case 409: return grpc.status.ALREADY_EXISTS;
    case 429: return grpc.status.RESOURCE_EXHAUSTED;
    default:  return grpc.status.INTERNAL;
  }
}

function handleError<T>(err: unknown, callback: grpc.sendUnaryData<T>): void {
  if (err instanceof AppError) {
    callback({ code: toGrpcStatus(err.status), message: err.message });
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
    const start = process.hrtime.bigint();
    let statusLabel = 'OK';
    const wrappedCb: grpc.sendUnaryData<Res> = (err, value, ...rest) => {
      if (err) {
        const code = (err as grpc.ServiceError).code ?? grpc.status.INTERNAL;
        statusLabel = grpc.status[code] ?? 'UNKNOWN';
      }
      const dur = Number(process.hrtime.bigint() - start) / 1e9;
      grpcRequestsTotal.inc({ method: methodName, status: statusLabel });
      grpcRequestDurationSeconds.observe({ method: methodName, status: statusLabel }, dur);
      (callback as (...args: unknown[]) => void)(err, value, ...rest);
    };
    await handler(call, wrappedCb);
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


async function subscribe(
  call: grpc.ServerUnaryCall<SubscribeRequest, MessageResponse>,
  callback: grpc.sendUnaryData<MessageResponse>,
): Promise<void> {
  const { email, repo } = call.request;
  if (!email || !EMAIL_REGEX.test(email)) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid or missing email' });
  }
  if (!repo) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'repo is required' });
  }
  try {
    await createSubscription(email, repo);
    callback(null, { message: 'Confirmation email sent' });
  } catch (err) {
    handleError(err, callback);
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
    await confirmSubscription(token);
    callback(null, { message: 'Subscription confirmed' });
  } catch (err) {
    handleError(err, callback);
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
    await unsubscribeUser(token);
    callback(null, { message: 'Unsubscribed successfully' });
  } catch (err) {
    handleError(err, callback);
  }
}

async function getSubscriptionsHandler(
  call: grpc.ServerUnaryCall<GetSubsRequest, GetSubsResponse>,
  callback: grpc.sendUnaryData<GetSubsResponse>,
): Promise<void> {
  const { email } = call.request;
  if (!email || !EMAIL_REGEX.test(email)) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid or missing email' });
  }
  try {
    const rows = await getSubscriptionsByEmail(email.trim());
    const subscriptions: SubscriptionItem[] = rows.map((s) => ({
      email:         s.email,
      repo:          s.repo,
      confirmed:     s.confirmed,
      last_seen_tag: s.last_seen_tag ?? '',
    }));
    callback(null, { subscriptions });
  } catch (err) {
    handleError(err, callback);
  }
}

export function createGrpcServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(proto.github_notifier.GitHubNotifier.service, {
    subscribe:            withGrpcMetrics('Subscribe', subscribe),
    confirmSubscription:  withGrpcMetrics('ConfirmSubscription', confirmSubscriptionHandler),
    unsubscribe:          withGrpcMetrics('Unsubscribe', unsubscribeHandler),
    getSubscriptions:     withGrpcMetrics('GetSubscriptions', getSubscriptionsHandler),
  });
  return server;
}

export function startGrpcServer(port: number): Promise<grpc.Server | null> {
  return new Promise((resolve) => {
    const server = createGrpcServer();
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          logger.warn({ port, err: err.message }, 'gRPC server failed to start');
          resolve(null);
          return;
        }
        logger.info({ port: boundPort }, 'gRPC server listening');
        resolve(server);
      },
    );
  });
}
