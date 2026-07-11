import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { toAppError, createGrpcRepositoryChecker } from '../../src/modules/github/grpc-repository-checker.js';

type VerifyRepoCallback = (err: grpc.ServiceError | null, response?: { exists: boolean }) => void;

const mockVerifyRepo = vi.fn<(request: { repo: string }, callback: VerifyRepoCallback) => void>();

vi.mock('../../src/gen/repo_verification/v1/repo_verification.js', () => ({
  RepoVerificationServiceClient: vi.fn().mockImplementation(() => ({
    verifyRepo: mockVerifyRepo,
  })),
}));

function makeServiceError(code: grpc.status, details?: string): grpc.ServiceError {
  return Object.assign(new Error(details ?? 'grpc error'), {
    code,
    details: details ?? '',
    metadata: new grpc.Metadata(),
  }) as grpc.ServiceError;
}

describe('toAppError', () => {
  it('maps NOT_FOUND to AppError(404)', () => {
    const result = toAppError(makeServiceError(grpc.status.NOT_FOUND));
    expect(result).toMatchObject({ status: 404, message: 'Repository not found' });
  });

  it('maps RESOURCE_EXHAUSTED to AppError(429)', () => {
    const result = toAppError(makeServiceError(grpc.status.RESOURCE_EXHAUSTED));
    expect(result).toMatchObject({ status: 429, message: 'GitHub rate limit exceeded' });
  });

  it('maps INVALID_ARGUMENT to AppError(400) using err.details when present', () => {
    const result = toAppError(makeServiceError(grpc.status.INVALID_ARGUMENT, 'repo is required'));
    expect(result).toMatchObject({ status: 400, message: 'repo is required' });
  });

  it('maps INVALID_ARGUMENT to a default message when details is empty', () => {
    const result = toAppError(makeServiceError(grpc.status.INVALID_ARGUMENT, ''));
    expect(result).toMatchObject({ status: 400, message: 'Invalid repository' });
  });

  it('maps any other status (e.g. UNAVAILABLE) to AppError(503)', () => {
    const result = toAppError(makeServiceError(grpc.status.UNAVAILABLE, 'upstream unreachable'));
    expect(result).toMatchObject({ status: 503, message: 'upstream unreachable' });
  });

  it('maps unknown status with no details to a default AppError(503) message', () => {
    const result = toAppError(makeServiceError(grpc.status.INTERNAL, ''));
    expect(result).toMatchObject({ status: 503, message: 'Repo verification unavailable' });
  });
});

describe('createGrpcRepositoryChecker', () => {
  beforeEach(() => {
    mockVerifyRepo.mockReset();
  });

  it('ensureExists resolves when the gRPC client reports no error', async () => {
    mockVerifyRepo.mockImplementation((_request, callback) => callback(null, { exists: true }));
    const checker = createGrpcRepositoryChecker('localhost:50052');

    await expect(checker.ensureExists('owner/repo')).resolves.toBeUndefined();
    expect(mockVerifyRepo).toHaveBeenCalledWith({ repo: 'owner/repo' }, expect.any(Function));
  });

  it('ensureExists rejects with the mapped AppError when the gRPC client errors', async () => {
    mockVerifyRepo.mockImplementation((_request, callback) =>
      callback(makeServiceError(grpc.status.NOT_FOUND)),
    );
    const checker = createGrpcRepositoryChecker('localhost:50052');

    await expect(checker.ensureExists('owner/missing')).rejects.toMatchObject({
      status: 404,
      message: 'Repository not found',
    });
  });
});
