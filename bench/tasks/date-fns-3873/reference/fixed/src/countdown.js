import { addMonths, differenceInHours, format } from 'date-fns';

/** Absolute due date shown on the ticket page, e.g. "Due 30 Sep 2024, 06:00". */
export function dueLabel(deadline) {
  return `Due ${format(deadline, 'd MMM yyyy, HH:mm')}`;
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Relative countdown shown next to the due date, e.g. "2 months, 3 days, 4 hours left".
 * `now` and `deadline` are Dates.
 */
export function timeLeftLabel(now, deadline) {
  if (deadline.getTime() <= now.getTime()) return 'overdue';
  let months = 0;
  while (addMonths(now, months + 1).getTime() <= deadline.getTime()) months++;
  const totalHours = differenceInHours(deadline, addMonths(now, months));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts = [];
  if (months) parts.push(plural(months, 'month'));
  if (days) parts.push(plural(days, 'day'));
  if (hours) parts.push(plural(hours, 'hour'));
  if (parts.length === 0) return 'less than an hour left';
  return `${parts.join(', ')} left`;
}
