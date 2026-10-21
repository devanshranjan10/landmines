import * as z from 'zod';

export const Driver = z.object({
  code: z.string().length(3),
  name: z.string().min(1),
  number: z.number().int().positive().optional(),
});

/** Validate the drivers list from the timing API. Throws on invalid input. */
export function parseDrivers(payload) {
  return z.array(Driver).parse(payload);
}

/**
 * Validate a session's classification from the timing API and normalise it to
 *   { position: number, driver: string, constructor: string | null, points: number }[]
 * Throws on invalid input.
 */
export function parseResults(payload) {
  throw new Error('not implemented');
}
