import { z } from 'zod';
import { AppError } from '../appError.js';

/** Parse input against a schema, throwing AppError with the first message on failure. */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  status = 400,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(status, result.error.issues[0].message);
  }
  return result.data;
}
