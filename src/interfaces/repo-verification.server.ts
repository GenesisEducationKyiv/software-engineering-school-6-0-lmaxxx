import * as grpc from '@grpc/grpc-js';
import { checkRepoExists } from '../modules/github/github.service.js';
import { AppError } from '../shared/appError.js';
import {
  RepoVerificationServiceService,
  type RepoVerificationServiceServer,
  type VerifyRepoResponse,
} from '../gen/repo_verification/v1/repo_verification.js';

/**
 * Maps an AppError (HTTP-style status) thrown by the REST GitHub client onto the
 * appropriate gRPC status code. Keeps error semantics intact across the wire.
 */
function toGrpcStatus(status: number): grpc.status {
  switch (status) {
    case 404: return grpc.status.NOT_FOUND;
    case 429: return grpc.status.RESOURCE_EXHAUSTED;
    case 400: return grpc.status.INVALID_ARGUMENT;
    default:  return grpc.status.UNAVAILABLE; // upstream GitHub unreachable / 5xx
  }
}

const verifyRepo: RepoVerificationServiceServer['verifyRepo'] = (call, callback) => {
  const repo = call.request.repo?.trim();
  if (!repo) {
    callback({ code: grpc.status.INVALID_ARGUMENT, message: 'repo is required' });
    return;
  }

  // Reuse the existing axios/HTTP REST implementation unchanged — this server is
  // a thin gRPC front for it, so the old REST path stays the single source of truth.
  checkRepoExists(repo)
    .then(() => {
      const response: VerifyRepoResponse = { exists: true };
      callback(null, response);
    })
    .catch((err: unknown) => {
      if (err instanceof AppError) {
        callback({ code: toGrpcStatus(err.status), message: err.message });
      } else {
        callback({
          code: grpc.status.UNAVAILABLE,
          message: err instanceof Error ? err.message : 'repo verification failed',
        });
      }
    });
};

/** Builds the RepoVerification gRPC server around the GitHub REST checker. */
export function createRepoVerificationServer(): grpc.Server {
  const server = new grpc.Server();
  server.addService(RepoVerificationServiceService, { verifyRepo });
  return server;
}

export function startRepoVerificationServer(port: number): Promise<grpc.Server | null> {
  return new Promise((resolve) => {
    const server = createRepoVerificationServer();
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) {
          console.warn(`RepoVerification gRPC server failed to start on port ${port}: ${err.message}`);
          resolve(null);
          return;
        }
        console.log(`RepoVerification gRPC server listening on port ${boundPort}`);
        resolve(server);
      },
    );
  });
}
