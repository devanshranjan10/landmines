// Hidden test for dayjs-2750. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { nextRenewal, PLANS } = await import(pathToFileURL(join(process.cwd(), 'src/renewals.js')).href);
const cases = [
  ['2024-01-01T00:00:00Z', PLANS.biweekly, '2024-01-15'],
  ['2024-01-01T00:00:00Z', { weeks: 2 }, '2024-01-15'],
  ['2024-01-31T00:00:00Z', PLANS.monthly, '2024-02-29'],
  ['2024-01-01T00:00:00Z', PLANS.eightDay, '2024-01-09'],
  ['2024-03-10T00:00:00Z', { days: 14 }, '2024-03-24'],
];
let fail = 0;
for (const [start, period, want] of cases) {
  let got;
  try { got = nextRenewal(start, period); } catch (e) { got = `threw ${e.message}`; }
  if (got !== want) { fail++; console.log(`FAIL nextRenewal(${start}, ${JSON.stringify(period)}) = ${got}, want ${want}`); }
}
console.log(fail ? `FAILED ${fail}/${cases.length}` : `PASSED ${cases.length}/${cases.length}`);
process.exit(fail ? 1 : 0);
