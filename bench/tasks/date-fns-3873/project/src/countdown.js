import { format } from 'date-fns';

/** Absolute due date shown on the ticket page, e.g. "Due 30 Sep 2024, 06:00". */
export function dueLabel(deadline) {
  return `Due ${format(deadline, 'd MMM yyyy, HH:mm')}`;
}

/**
 * Relative countdown shown next to the due date, e.g. "2 months, 3 days, 4 hours left".
 * `now` and `deadline` are Dates.
 */
export function timeLeftLabel(now, deadline) {
  throw new Error('not implemented');
}
