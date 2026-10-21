// Hidden test for dayjs-3279. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { alarmTime, snoozeUntil } = await import(pathToFileURL(join(process.cwd(), 'src/alarms.js')).href);
const start = '2025-06-10T09:00:00Z';
const cases = [
  [start, 'PT0S', '2025-06-10T09:00:00Z'],
  [start, 'PT5M', '2025-06-10T09:05:00Z'],
  [start, '+PT5M', '2025-06-10T09:05:00Z'],
  [start, '-PT15M', '2025-06-10T08:45:00Z'],
  [start, '-PT1H30M', '2025-06-10T07:30:00Z'],
  [start, '-P1D', '2025-06-09T09:00:00Z'],
  ['2025-03-01T00:10:00Z', '-PT20M', '2025-02-28T23:50:00Z'],
  [start, '-P1DT2H', '2025-06-09T07:00:00Z'],
];
let fail = 0;
for (const [s, trig, want] of cases) {
  let got;
  try { got = alarmTime(s, trig); } catch (e) { got = `threw ${e.message}`; }
  if (got !== want) { fail++; console.log(`FAIL alarmTime(${s}, ${trig}) = ${got}, want ${want}`); }
}
const total = cases.length + 1;
try { if (snoozeUntil(start) !== '2025-06-10T09:10:00Z') { fail++; console.log('FAIL snoozeUntil changed'); } } catch (e) { fail++; console.log(`FAIL snoozeUntil threw ${e.message}`); }
console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
