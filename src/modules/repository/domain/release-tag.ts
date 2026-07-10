import { z } from 'zod';

export const ReleaseTag = z.string().min(1, 'Release tag must not be empty').brand('ReleaseTag');
export type ReleaseTag = z.infer<typeof ReleaseTag>;
