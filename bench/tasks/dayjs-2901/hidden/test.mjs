// Hidden test for dayjs-2901. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const mod = await import(pathToFileURL(join(process.cwd(), 'src/shifts.js')).href);
const cases = [
  [600, '6:00 AM'],
  ['930', '9:30 AM'],
  [745, '7:45 AM'],
  [1430, '2:30 PM'],
  ['1200', '12:00 PM'],
  [2359, '11:59 PM'],
  [5, '12:05 AM'],
  [0, '12:00 AM'],
];
let fail = 0;
for (const [value, want] of cases) {
  let got;
  try { got = mod.formatShiftTime(value); } catch (e) { got = `threw ${e.message}`; }
  if (got !== want) { fail++; console.log(`FAIL formatShiftTime(${JSON.stringify(value)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
let label;
try { label = mod.shiftLabel({ date: '03/03/2025', start: 1430 }); } catch (e) { label = `threw ${e.message}`; }
if (label !== 'Mon 3 Mar, 2:30 PM') { fail++; console.log(`FAIL shiftLabel = ${JSON.stringify(label)}`); }
const total = cases.length + 1;
console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
