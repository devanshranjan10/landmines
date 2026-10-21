// Hidden test for yaml-733. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { exportSnippets, importSnippets } = await import(pathToFileURL(join(process.cwd(), 'src/snippets.js')).href);
let fail = 0, total = 0;
function check(label, got, want) {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function roundTrip(label, lib) {
  let out;
  try { out = exportSnippets(lib); } catch (e) { check(label, `threw ${e.message}`, lib); return; }
  let back; try { back = importSnippets(out); } catch (e) { back = `parse threw ${e.message.split('\n')[0]}`; }
  check(`${label} round trip`, back, lib);
  return out;
}
const simple = { snippets: {
  log: { prefix: 'log', description: 'console.log', body: 'console.log(${1:value});\n' },
  fn: { prefix: 'fn', body: 'function ${1:name}(${2}) {\n  ${0}\n}' },
} };
const out = roundTrip('simple', simple);
if (typeof out === 'string') {
  const lines = out.split('\n');
  check('names indented 4', lines.includes('    log:') && lines.includes('    fn:'), true);
  check('fields indented 8', lines.includes('        prefix: log'), true);
}
roundTrip('indented fragments', { snippets: {
  guard: { prefix: 'guard', description: 'early return', body: '    if (!user) {\n        return null;\n    }\n' },
  tryCatch: { prefix: 'tc', body: '  try {\n    ${0}\n  } catch (err) {\n    logger.error(err);\n  }' },
  plain: { prefix: 'p', body: 'line one\nline two\n' },
} });
roundTrip('empty library', { snippets: {} });
console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
