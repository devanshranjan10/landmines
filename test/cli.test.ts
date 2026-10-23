import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

describe('cli', () => {
  it('prints the package version', async () => {
    const { stdout } = await run(process.execPath, ['dist/cli.js', '--version'], { cwd: new URL('..', import.meta.url) });
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('lookup prints the issues filed against exact versions, and refuses ranges', async () => {
    const env = { ...process.env, LANDMINE_HTTP_REPLAY: fileURLToPath(new URL('./fixtures/http/scan-demo/', import.meta.url)), NO_COLOR: '1' };
    const { stdout } = await run(process.execPath, ['dist/cli.js', 'lookup', '-m', '30', 'drizzle-orm@0.36.0', 'requests==2.32.3'], { cwd: new URL('..', import.meta.url), env });
    expect(stdout).toMatch(/^drizzle-orm@0\.36\.0 \(drizzle-team\/drizzle-orm\): \d+ open GitHub issues/);
    expect(stdout).toContain('drizzle-team/drizzle-orm#3402');
    expect(stdout).toContain('requests==2.32.3 (psf/requests)');
    await expect(run(process.execPath, ['dist/cli.js', 'lookup', 'react@^19'], { cwd: new URL('..', import.meta.url), env })).rejects.toMatchObject({ code: 2 });
  });
});
