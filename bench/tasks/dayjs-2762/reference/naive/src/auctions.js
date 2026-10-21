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
  const ms = Math.max(0, dayjs.utc(endIso).diff(dayjs.utc(nowIso)));
  const d = dayjs.duration(ms);
  return `${Math.floor(d.asDays())}d ${d.hours()}h ${d.minutes()}m ${d.seconds()}s`;
}
