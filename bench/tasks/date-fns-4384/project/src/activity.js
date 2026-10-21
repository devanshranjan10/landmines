import { format, isSameDay } from 'date-fns';

/** Absolute timestamp shown in the tooltip, e.g. "Mar 4, 2025, 14:05". */
export function absoluteLabel(date) {
  return format(date, 'MMM d, yyyy, HH:mm');
}

/** Group header for an activity item: "Today" or the calendar date. */
export function groupLabel(date, now = new Date()) {
  return isSameDay(date, now) ? 'Today' : format(date, 'EEEE, MMM d');
}

/**
 * Relative label for an activity item, e.g. "5 minutes ago" or "in 2 hours".
 * `now` is injectable for tests.
 */
export function relativeLabel(date, now = new Date()) {
  throw new Error('not implemented');
}
