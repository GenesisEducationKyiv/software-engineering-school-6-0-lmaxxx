import { z } from 'zod';
import { REPO_REGEX } from '../../validators/index.js';

export const RepoSlug = z
  .string()
  .regex(REPO_REGEX, 'Invalid repo format — expected owner/repo')
  .brand('RepoSlug');
export type RepoSlug = z.infer<typeof RepoSlug>;
