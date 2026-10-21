import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/** Roster dates arrive as "DD/MM/YYYY"; returns e.g. "Mon 3 Mar". */
export function formatShiftDate(raw) {
  return dayjs(raw, 'DD/MM/YYYY').format('ddd D MMM');
}

/**
 * Shift start time from the legacy roster: 24h clock value without leading zeros or separator,
 * e.g. 600 (06:00), 1430 (14:30), 5 (00:05). Number or numeric string.
 * Returns 'h:mm A', e.g. '6:00 AM'.
 */
export function formatShiftTime(value) {
  return dayjs(String(value).padStart(4, '0'), 'HHmm', true).format('h:mm A');
}

/** "Mon 3 Mar, 6:00 AM" */
export function shiftLabel(shift) {
  return `${formatShiftDate(shift.date)}, ${formatShiftTime(shift.start)}`;
}
