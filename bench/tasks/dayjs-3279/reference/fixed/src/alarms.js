import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(duration);
dayjs.extend(utc);

const OUT = 'YYYY-MM-DDTHH:mm:ss[Z]';

/** When a snoozed alarm fires again: `firedAtIso` (UTC) plus `minutes`. */
export function snoozeUntil(firedAtIso, minutes = 10) {
  return dayjs.utc(firedAtIso).add(dayjs.duration({ minutes })).format(OUT);
}

/**
 * Absolute fire time of a VALARM whose TRIGGER is relative to the event start.
 * `startIso` is the event start (UTC), `trigger` the TRIGGER value, e.g. "-PT15M".
 * Returns 'YYYY-MM-DDTHH:mm:ssZ' (UTC).
 */
export function alarmTime(startIso, trigger) {
  const m = /^([+-])?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(trigger.trim());
  if (!m) throw new Error(`unsupported TRIGGER: ${trigger}`);
  const [, sign, d = 0, h = 0, min = 0, sec = 0] = m;
  const ms = (((+d * 24 + +h) * 60 + +min) * 60 + +sec) * 1000;
  return dayjs.utc(startIso).add(sign === '-' ? -ms : ms, 'millisecond').format(OUT);
}
