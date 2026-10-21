// Hidden test for date-fns-4384. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { relativeLabel, absoluteLabel } = await import(pathToFileURL(join(process.cwd(), 'src/activity.js')).href);
const now = new Date(2025, 2, 4, 14, 0, 0);
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
const ago = (ms) => new Date(+now - ms);
const ahead = (ms) => new Date(+now + ms);
const cases = [
  [ago(45 * S), '45 seconds ago'],
  [ago(1 * S), '1 second ago'],
  [ago(90 * S), '2 minutes ago'],
  [ago(3 * H), '3 hours ago'],
  [ahead(2 * H), 'in 2 hours'],
  [ago(5 * D), '5 days ago'],
  [ago(59.6 * S), '1 minute ago'],
  [ago(59 * M + 45 * S), '1 hour ago'],
  [ago(23 * H + 50 * M), '1 day ago'],
  [ahead(59 * M + 40 * S), 'in 1 hour'],
];
let fail = 0;
for (const [date, want] of cases) {
  let got;
  try { got = relativeLabel(date, now); } catch (e) { got = `threw ${e.message}`; }
  if (got !== want) { fail++; console.log(`FAIL relativeLabel(now ${date - now >= 0 ? '+' : '-'} ${Math.abs(date - now)} ms) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
let total = cases.length + 1;
try { if (absoluteLabel(now) !== 'Mar 4, 2025, 14:00') { fail++; console.log('FAIL absoluteLabel changed'); } } catch (e) { fail++; console.log(`FAIL absoluteLabel threw ${e.message}`); }
console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
