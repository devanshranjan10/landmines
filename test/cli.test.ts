import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

describe('cli', () => {
  beforeAll(async () => {
    await run('npx', ['tsup', '--silent'], { cwd: new URL('..', import.meta.url) });
  }, 60_000);

  it('prints the package version', async () => {
    const { stdout } = await run(process.execPath, ['dist/cli.js', '--version'], { cwd: new URL('..', import.meta.url) });
    expect(stdout.trim()).toBe(pkg.version);
  });
});
