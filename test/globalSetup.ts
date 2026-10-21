import { execFileSync } from 'node:child_process';

/** Build dist/ once before any test that runs the real CLI binary. */
export default function setup(): void {
  // npx is a .cmd shim on Windows, which only a shell can start.
  execFileSync('npx', ['tsup', '--silent'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', shell: process.platform === 'win32' });
}
