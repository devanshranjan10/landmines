// Hidden test for knex-6074. Compiles the queries for Postgres (no database needed). Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(join(process.cwd(), 'package.json'));
const knex = require('knex');
const db = knex({ client: 'pg' });
const mod = await import(pathToFileURL(join(process.cwd(), 'src/sessions.js')).href);

let fail = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { fail++; console.log(`FAIL ${msg}`); } };
const sqlOf = (fn) => {
  try {
    const q = fn();
    if (!q || typeof q.toString !== 'function' || typeof q.toSQL !== 'function') return `not a knex query: ${typeof q}`;
    return q.toString();
  } catch (e) { return `threw ${e.message}`; }
};

const now = new Date('2024-01-01T00:00:00Z');
for (const [args, n] of [[[db, now, 100], 100], [[db, now, 25], 25], [[db, now], 1000]]) {
  const sql = sqlOf(() => mod.purgeExpiredSessions(...args));
  const label = `purgeExpiredSessions(db, now${args[2] ? `, ${args[2]}` : ''})`;
  check(/^\s*delete\s+from\s+"sessions"/i.test(sql), `${label} should be a DELETE on sessions: ${sql}`);
  check(/"?expires_at"?\s*<\s*'2024-01-01/i.test(sql), `${label} should only target sessions with expires_at < now: ${sql}`);
  check(new RegExp(`\\blimit\\s+${n}\\b`, 'i').test(sql), `${label} must delete at most ${n} rows: ${sql}`);
}

// Existing exports keep working.
check(sqlOf(() => mod.revokeUserSessions(db, 7)) === 'delete from "sessions" where "user_id" = 7', 'revokeUserSessions changed');
check(sqlOf(() => mod.findSessionByToken(db, 'abc')) === `select * from "sessions" where "token" = 'abc' limit 1`, 'findSessionByToken changed');

console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
