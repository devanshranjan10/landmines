import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);

/** Amount column, e.g. "1.234,56" or "-12,00". Returns a number or null. */
export function parseAmount(raw) {
  const s = String(raw ?? '').trim();
  if (!/^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(s)) return null;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

/** Value date column, e.g. "20241224". Returns 'YYYY-MM-DD', or null when the cell is not a real date. */
export function parseValueDate(raw) {
  const d = dayjs(String(raw ?? '').trim(), 'YYYYMMDD', true);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

/**
 * Booking timestamp column, e.g. "20241224 061500 +0600" (branch local time + UTC offset).
 * Returns an ISO-8601 UTC string, or null when the cell is malformed.
 */
export function parseBookingTime(raw) {
  const d = dayjs(String(raw ?? '').trim(), 'YYYYMMDD HHmmss ZZ', true);
  return d.isValid() ? d.toISOString() : null;
}
