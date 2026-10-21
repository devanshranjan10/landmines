import { format, formatDistanceStrict, isSameDay } from 'date-fns';

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
  const ms = Math.abs(date - now);
  // Pick the unit from the rounded value so that e.g. 59.6 s rolls over to "1 minute".
  let unit = 'day';
  if (Math.round(ms / 1000) < 60) unit = 'second';
  else if (Math.round(ms / 60000) < 60) unit = 'minute';
  else if (Math.round(ms / 3600000) < 24) unit = 'hour';
  return formatDistanceStrict(date, now, { addSuffix: true, unit });
}
