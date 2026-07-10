import { upsertRepository } from './repository.repository.js';
import type { RepositoryRegistrar } from '../subscription/ports/repository-registrar.js';

export function createRepositoryRegistrar(): RepositoryRegistrar {
  return {
    ensureTracked(repo) {
      return upsertRepository(repo);
    },
  };
}
