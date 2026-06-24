import { z } from 'zod';
import { EMAIL_REGEX } from '../../validators/index.js';

export const Email = z.string().regex(EMAIL_REGEX, 'Invalid email format').brand('Email');
export type Email = z.infer<typeof Email>;
