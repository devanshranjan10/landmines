import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(duration);
dayjs.extend(utc);

export const PLANS = {
  biweekly: { weeks: 2 },
  monthly: { months: 1 },
  eightDay: { weeks: 1, days: 1 },
};

/** Human label for a plan period, e.g. "every 14 days". */
export function periodLabel(period) {
  return `every ${dayjs.duration(period).asDays()} days`;
}

/**
 * Next renewal date for a subscription that started at `startIso` (UTC) on a plan with `period`.
 * Returns 'YYYY-MM-DD' (UTC).
 */
export function nextRenewal(startIso, period) {
  return dayjs.utc(startIso).add(dayjs.duration(period)).format("YYYY-MM-DD");
}
