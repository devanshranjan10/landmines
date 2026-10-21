// Hidden test for zod-6666. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { parseResults, parseDrivers } = await import(pathToFileURL(join(process.cwd(), 'src/results.js')).href);
let fail = 0, total = 0;
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? `[function ${x.name}]` : x));
function ok(label, fn, want) {
  total++;
  let got; try { got = fn(); } catch (e) { got = `threw ${e.message.split('\n')[0]}`; }
  if (show(got) !== show(want)) { fail++; console.log(`FAIL ${label}: got ${show(got)}, want ${show(want)}`); }
}
function throws(label, fn) {
  total++;
  try { const got = fn(); fail++; console.log(`FAIL ${label}: expected a throw, got ${show(got)}`); } catch { /* expected */ }
}
const api = (s) => JSON.parse(s);
ok('full rows', () => parseResults(api('[{"position":1,"driver":"VER","constructor":"Red Bull Racing","points":25},{"position":2,"driver":"NOR","constructor":"McLaren","points":18.5}]')), [
  { position: 1, driver: 'VER', constructor: 'Red Bull Racing', points: 25 },
  { position: 2, driver: 'NOR', constructor: 'McLaren', points: 18.5 },
]);
ok('row without constructor', () => parseResults(api('[{"position":1,"driver":"FAN","points":0}]')), [
  { position: 1, driver: 'FAN', constructor: null, points: 0 },
]);
ok('mixed rows', () => parseResults(api('[{"position":1,"driver":"HAM","constructor":"Ferrari","points":25},{"position":2,"driver":"TST","points":0}]')), [
  { position: 1, driver: 'HAM', constructor: 'Ferrari', points: 25 },
  { position: 2, driver: 'TST', constructor: null, points: 0 },
]);
ok('empty classification', () => parseResults(api('[]')), []);
throws('missing driver', () => parseResults(api('[{"position":1,"constructor":"Ferrari","points":25}]')));
throws('numeric constructor', () => parseResults(api('[{"position":1,"driver":"LEC","constructor":42,"points":25}]')));
throws('empty constructor', () => parseResults(api('[{"position":1,"driver":"LEC","constructor":"","points":25}]')));
throws('negative points', () => parseResults(api('[{"position":1,"driver":"LEC","points":-1}]')));
throws('position 0', () => parseResults(api('[{"position":0,"driver":"LEC","points":1}]')));
ok('parseDrivers', () => parseDrivers([{ code: 'VER', name: 'Max Verstappen', number: 1 }]), [{ code: 'VER', name: 'Max Verstappen', number: 1 }]);
console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
