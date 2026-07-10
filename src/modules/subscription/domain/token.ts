import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { UUID_REGEX } from '../../../validators/index.js';

export const Token = z.string().regex(UUID_REGEX, 'Invalid token').brand('Token');
export type Token = z.infer<typeof Token>;

export function generateToken(): Token {
  return randomUUID() as Token;
}
