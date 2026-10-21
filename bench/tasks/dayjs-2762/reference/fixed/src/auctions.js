import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(duration);
dayjs.extend(utc);

/** True when the auction closes within the next 24 hours. */
export function isEndingSoon(nowIso, endIso) {
  const left = dayjs.duration(dayjs.utc(endIso).diff(dayjs.utc(nowIso)));
  return left.asMilliseconds() > 0 && left.asHours() < 24;
}

/**
 * Countdown shown on the auction card: total whole days + remaining h/m/s, e.g. "58d 23h 59m 59s".
 * "0d 0h 0m 0s" once the auction has ended.
 */
export function timeLeft(nowIso, endIso) {
  const total = Math.floor(Math.max(0, dayjs.utc(endIso).diff(dayjs.utc(nowIso))) / 1000);
  const days = Math.floor(total / 86400);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  return `${days}d ${h}h ${m}m ${total % 60}s`;
}
