import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { createSubscription, confirmSubscription, unsubscribeUser } from '../services/subscription.js';
import { findConfirmedByEmail } from '../db/subscriptions.js';
import { AppError } from '../shared/appError.js';

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

interface SubscribeRequest   { email: string; repo: string }
interface TokenRequest       { token: string }
interface GetSubsRequest     { email: string }
interface MessageResponse    { message: string }
interface SubscriptionItem   {
  email: string; repo: string; confirmed: boolean; last_seen_tag: string;
}
interface GetSubsResponse    { subscriptions: SubscriptionItem[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function subscribe(
  call: grpc.ServerUnaryCall<SubscribeRequest, MessageResponse>,
  callback: grpc.sendUnaryData<MessageResponse>,
): Promise<void> {
  const { email, repo } = call.request;
  if (!email || !EMAIL_RE.test(email)) {
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
  if (!email || !EMAIL_RE.test(email)) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid or missing email' });
  }
  try {
    const rows = await findConfirmedByEmail(email.trim());
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
    subscribe,
    confirmSubscription: confirmSubscriptionHandler,
    unsubscribe: unsubscribeHandler,
    getSubscriptions: getSubscriptionsHandler,
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
          console.warn(`gRPC server failed to start on port ${port}: ${err.message}`);
          resolve(null);
          return;
        }
        console.log(`gRPC server listening on port ${boundPort}`);
        resolve(server);
      },
    );
  });
}
