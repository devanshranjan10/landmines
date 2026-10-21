// Hidden test for dayjs-2818. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const mod = await import(pathToFileURL(join(process.cwd(), 'src/manifest.js')).href);
const cases = [
  ['29.Jul.21', '2021-07-29'],
  ['03.Jan.24', '2024-01-03'],
  ['15.Sep.23', '2023-09-15'],
  ['31.Dec.25', '2025-12-31'],
  ['31.Feb.23', null],
  ['not a date', null],
  ['', null],
];
let fail = 0;
for (const [raw, want] of cases) {
  let got;
  try { got = mod.parseNordfrachtDate(raw); } catch (e) { got = `threw ${e.message}`; }
  if (got !== want) { fail++; console.log(`FAIL parseNordfrachtDate(${JSON.stringify(raw)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
const rows = [
  [{ carrier: 'nordfracht', ref: 'NF-1', shipped: '29.Jul.21' }, { ref: 'NF-1', shippedOn: '2021-07-29' }],
  [{ carrier: 'baltline', ref: 'BL-7', shipped: '29/07/2021' }, { ref: 'BL-7', shippedOn: '2021-07-29' }],
];
for (const [row, want] of rows) {
  let got;
  try { got = mod.normalizeRow(row); } catch (e) { got = `threw ${e.message}`; }
  if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`FAIL normalizeRow(${JSON.stringify(row)}) = ${JSON.stringify(got)}`); }
}
const total = cases.length + rows.length;
console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
