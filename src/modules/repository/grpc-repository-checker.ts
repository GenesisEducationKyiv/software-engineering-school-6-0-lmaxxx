import * as grpc from '@grpc/grpc-js';
import { AppError } from '../../shared/appError.js';
import type { RepositoryChecker } from '../subscription/ports/repository-checker.js';
import { RepoVerificationServiceClient } from '../../gen/repo_verification/v1/repo_verification.js';

/** Inverse of the server mapping: gRPC status -> AppError the service expects. */
function toAppError(err: grpc.ServiceError): AppError {
  switch (err.code) {
    case grpc.status.NOT_FOUND:          return new AppError(404, 'Repository not found');
    case grpc.status.RESOURCE_EXHAUSTED: return new AppError(429, 'GitHub rate limit exceeded');
    case grpc.status.INVALID_ARGUMENT:   return new AppError(400, err.details || 'Invalid repository');
    default:                             return new AppError(503, err.details || 'Repo verification unavailable');
  }
}

/**
 * gRPC-backed RepositoryChecker: the SubscriptionService talks to the
 * RepoVerificationService over gRPC (HTTP/2 + protobuf) instead of calling the
 * GitHub HTTP REST endpoint in-process. Drop-in for createGitHubRepositoryChecker.
 */
export function createGrpcRepositoryChecker(target: string): RepositoryChecker {
  const client = new RepoVerificationServiceClient(
    target,
    grpc.credentials.createInsecure(),
  );

  return {
    ensureExists(repo) {
      return new Promise<void>((resolve, reject) => {
        client.verifyRepo({ repo: String(repo) }, (err, _response) => {
          if (err) {
            reject(toAppError(err));
            return;
          }
          resolve();
        });
      });
    },
  };
}
