import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { UUID_REGEX } from '../../../validators/index.js';

export const Token = z.string().regex(UUID_REGEX, 'Invalid token').brand('Token');
export type Token = z.infer<typeof Token>;

export function generateToken(): Token {
  return uuidv4() as Token;
}
