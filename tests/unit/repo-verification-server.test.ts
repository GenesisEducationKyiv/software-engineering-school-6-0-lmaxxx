import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { verifyRepo } from '../../src/modules/repository/interfaces/grpc/repo-verification.server.js';
import { checkRepoExists } from '../../src/modules/github/github.service.js';
import { AppError } from '../../src/shared/appError.js';

vi.mock('../../src/modules/github/github.service.js', () => ({
  checkRepoExists: vi.fn(),
}));

const mockCheckRepoExists = vi.mocked(checkRepoExists);

function makeCall(repo: string | undefined) {
  return { request: { repo } } as Parameters<typeof verifyRepo>[0];
}

describe('verifyRepo (RepoVerificationService)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls back with exists: true when checkRepoExists resolves', async () => {
    mockCheckRepoExists.mockResolvedValue(undefined);
    const callback = vi.fn();

    verifyRepo(makeCall('owner/repo'), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());

    expect(mockCheckRepoExists).toHaveBeenCalledWith('owner/repo');
    expect(callback).toHaveBeenCalledWith(null, { exists: true });
  });

  it('rejects empty repo with INVALID_ARGUMENT without calling checkRepoExists', () => {
    const callback = vi.fn();

    verifyRepo(makeCall(''), callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.INVALID_ARGUMENT }),
    );
    expect(mockCheckRepoExists).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only repo with INVALID_ARGUMENT', () => {
    const callback = vi.fn();

    verifyRepo(makeCall('   '), callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.INVALID_ARGUMENT }),
    );
    expect(mockCheckRepoExists).not.toHaveBeenCalled();
  });

  it('maps AppError(404) to NOT_FOUND', async () => {
    mockCheckRepoExists.mockRejectedValue(new AppError(404, 'Repository not found'));
    const callback = vi.fn();

    verifyRepo(makeCall('owner/missing'), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.NOT_FOUND, message: 'Repository not found' }),
    );
  });

  it('maps AppError(429) to RESOURCE_EXHAUSTED', async () => {
    mockCheckRepoExists.mockRejectedValue(new AppError(429, 'GitHub rate limit exceeded'));
    const callback = vi.fn();

    verifyRepo(makeCall('owner/repo'), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.RESOURCE_EXHAUSTED }),
    );
  });

  it('maps AppError(400) to INVALID_ARGUMENT', async () => {
    mockCheckRepoExists.mockRejectedValue(new AppError(400, 'Invalid repository'));
    const callback = vi.fn();

    verifyRepo(makeCall('bad repo'), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.INVALID_ARGUMENT }),
    );
  });

  it('maps unmapped AppError status and generic errors to UNAVAILABLE', async () => {
    mockCheckRepoExists.mockRejectedValue(new AppError(503, 'upstream down'));
    const callback = vi.fn();

    verifyRepo(makeCall('owner/repo'), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.UNAVAILABLE, message: 'upstream down' }),
    );
  });

  it('maps non-AppError rejections to UNAVAILABLE using the error message', async () => {
    mockCheckRepoExists.mockRejectedValue(new Error('network failure'));
    const callback = vi.fn();

    verifyRepo(makeCall('owner/repo'), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpc.status.UNAVAILABLE, message: 'network failure' }),
    );
  });
});
