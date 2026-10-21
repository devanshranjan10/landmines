// The `landmine` executable. It imports nothing, so it can say clearly when Node is too old: the real CLI's static
// imports would otherwise fail first, with an obscure link error.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  process.stderr.write(`landmine needs Node.js 22.12 or newer; this is Node ${process.versions.node}. Update Node (https://nodejs.org) and try again.\n`);
  process.exit(2);
}
// A variable specifier keeps the bundler from inlining the CLI into this file. No top-level await, so this file parses
// even where it would be read as CommonJS.
const entry = './main.js';
import(entry).catch((err: unknown) => {
  process.stderr.write(`landmine: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
});
