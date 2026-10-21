// How many armed issues sit at each usage level in real repos: how much competition the 15-item rules list faces.
// Each repo must already be cloned, scanned and carded:
//   git clone --depth 1 https://github.com/<repo> /tmp/lm-real/<name> && landmine scan && landmine cards
//   npx tsx scripts/bench/real-usage.ts [/tmp/lm-real/<name> ...]
import { isArmed } from '../../src/policy.js';
import { readIndex } from '../../src/store.js';
import { projectUsage } from '../../src/usage.js';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['expense.fyi', 'page-spy-web', 'zpy'].map((d) => `/tmp/lm-real/${d}`);
for (const root of roots) {
  const index = readIndex(root);
  if (!index) {
    console.log(`${root}: no index`);
    continue;
  }
  const usage = projectUsage(root, index);
  const armed = index.landmines.filter(isArmed);
  const c = [0, 0, 0];
  for (const l of armed) {
    const level = usage.get(`${l.id}@${l.version}`) ?? 0;
    c[level] = (c[level] ?? 0) + 1;
  }
  const carded = index.landmines.filter((l) => l.card).length;
  console.log(
    `${root}: ${index.packages.length} packages, ${index.landmines.length} issues (${carded} carded), ${armed.length} armed; usage 2 (API used): ${c[2]}, usage 1 (package imported): ${c[1]}, usage 0: ${c[0]}`,
  );
}
