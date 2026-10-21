import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);

/** Accepted birth-date formats: web form, then kiosk. */
export const BIRTH_DATE_FORMATS = ['YYYY-MM-DD', 'YYYY/M/D'];

export const BIRTH_DATE_HINT = `Use one of: ${BIRTH_DATE_FORMATS.join(', ')}`;

/**
 * Birth date from an intake form, in one of BIRTH_DATE_FORMATS.
 * Returns midnight UTC as an ISO string (e.g. '1995-05-01T00:00:00.000Z'), or null if invalid.
 */
export function normalizeBirthDate(raw) {
  const s = String(raw ?? '').trim();
  for (const fmt of BIRTH_DATE_FORMATS) {
    const d = dayjs.utc(s, fmt, true);
    if (d.isValid()) return d.toISOString();
  }
  return null;
}

/** Age in whole years at `onIso` (UTC). */
export function ageOn(birthIso, onIso) {
  return dayjs.utc(onIso).diff(dayjs.utc(birthIso), 'year');
}
