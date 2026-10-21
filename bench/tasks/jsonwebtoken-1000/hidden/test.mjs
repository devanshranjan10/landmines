// Hidden test for jsonwebtoken-1000. Run from the task's working directory.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { issueServiceToken, verifyToken } = await import(pathToFileURL(join(process.cwd(), 'src/tokens.js')).href);

// Collect every callback invocation for a while, so double calls are visible.
function issue(claims) {
  return new Promise((resolve) => {
    const calls = [];
    try {
      issueServiceToken(claims, (err, token) => calls.push({ err, token }));
    } catch (e) {
      calls.push({ threw: e });
    }
    setTimeout(() => resolve(calls), 250);
  });
}
const verify = (token) => new Promise((resolve) => verifyToken(token, (err, payload) => resolve({ err, payload })));

let fail = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { fail++; console.log(`FAIL ${msg}`); } };
const show = (calls) => JSON.stringify(calls.map((c) => (c.threw ? `threw ${c.threw.message}` : c.err ? `err ${c.err.message}` : `token ${String(c.token).slice(0, 16)}...`)));

// Ordinary cases: one token, verifiable, with our iss/aud and a 15 minute lifetime.
for (const claims of [{ sub: 'svc-billing' }, { sub: 'svc-reports', scope: 'read:invoices', tenant: 't-42' }]) {
  const calls = await issue(claims);
  const ok = calls.length === 1 && !calls[0].err && !calls[0].threw && typeof calls[0].token === 'string';
  check(ok, `issueServiceToken(${JSON.stringify(claims)}) should call back once with a token, got ${show(calls)}`);
  if (!ok) continue;
  const { err, payload } = await verify(calls[0].token);
  check(!err, `token for ${JSON.stringify(claims)} rejected by verifyToken: ${err && err.message}`);
  if (err) continue;
  check(payload.iss === 'acme-auth' && payload.aud === 'acme-api', `iss/aud wrong: ${JSON.stringify(payload)}`);
  check(payload.exp - payload.iat === 900, `lifetime should be 900 s, got ${payload.exp - payload.iat}`);
  for (const [k, v] of Object.entries(claims)) check(payload[k] === v, `claim ${k} missing/wrong in ${JSON.stringify(payload)}`);
}

// Callers may not choose iss, aud or exp: exactly one callback, with an error, and no token.
for (const claims of [
  { sub: 'svc-billing', iss: 'someone-else' },
  { sub: 'svc-billing', aud: 'other-api' },
  { sub: 'svc-billing', exp: 4102444800 },
]) {
  const calls = await issue(claims);
  const ok = calls.length === 1 && calls[0].err instanceof Error && calls[0].token === undefined;
  check(ok, `issueServiceToken(${JSON.stringify(claims)}) should call back exactly once with an error, got ${show(calls)}`);
}

console.log(fail ? `FAILED ${fail}/${total}` : `PASSED ${total}/${total}`);
process.exit(fail ? 1 : 0);
