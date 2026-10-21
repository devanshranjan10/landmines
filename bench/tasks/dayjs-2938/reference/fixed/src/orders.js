import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** `limit` query param: 1..100, default 20. */
export function parseLimit(raw) {
  if (raw === undefined || raw === '') return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new HttpError(400, 'limit must be an integer between 1 and 100');
  return n;
}

/**
 * `since` query param: optional 'YYYY-MM-DD'.
 * Returns null when absent, the date as 'YYYY-MM-DD' when valid, throws HttpError(400) otherwise.
 */
export function parseSince(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = dayjs(String(raw), 'YYYY-MM-DD', true);
  if (!d.isValid()) throw new HttpError(400, 'since must be a date in YYYY-MM-DD format');
  return d.format('YYYY-MM-DD');
}

/** GET /orders: filters the given orders (each with `placedAt` ISO string) by the query. */
export function listOrders(orders, query = {}) {
  try {
    const limit = parseLimit(query.limit);
    const since = parseSince(query.since);
    const rows = orders
      .filter((o) => !since || dayjs(o.placedAt).format('YYYY-MM-DD') >= since)
      .slice(0, limit);
    return { status: 200, body: rows };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
    throw err;
  }
}
