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

const ResultRow = z.object({
  position: z.number().int().positive(),
  driver: z.string().length(3),
  constructor: z.string().min(1).nullable(),
  points: z.number().nonnegative(),
});

/**
 * Validate a session's classification from the timing API and normalise it to
 *   { position: number, driver: string, constructor: string | null, points: number }[]
 * Throws on invalid input.
 */
export function parseResults(payload) {
  const rows = z.array(z.record(z.string(), z.unknown())).parse(payload);
  // Only an own `constructor` field counts; fill the absent case explicitly.
  return rows
    .map((r) => ({ ...r, constructor: Object.hasOwn(r, 'constructor') ? r.constructor : null }))
    .map((r) => ResultRow.parse(r))
    .map((r) => ({ position: r.position, driver: r.driver, constructor: r.constructor, points: r.points }));
}
