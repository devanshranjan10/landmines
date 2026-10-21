import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

/** Per user: on Linux the temp dir is shared, and another user's directory would be unwritable. */
export function defaultStateDir(): string {
  let user = 'user';
  try {
    user = String(process.getuid?.() ?? userInfo().username);
  } catch {
    // keep the default
  }
  return join(tmpdir(), `landmine-${user}`);
}

const h = (s: string, n: number): string => createHash('sha1').update(s).digest('hex').slice(0, n);

/**
 * Remembers which issues the agent has already been shown in a session, so the hook
 * blocks once and lets the retry through. Lives outside the repo, under the OS temp dir.
 */
export class ShownState {
  private readonly dir: string;

  constructor(root: string, session: string, base: string = defaultStateDir()) {
    this.dir = join(base, h(root, 12), h(session, 16));
  }

  private file(id: string): string {
    return join(this.dir, h(id, 16));
  }

  has(id: string): boolean {
    return existsSync(this.file(id));
  }

  /** Atomically claim an issue for showing. False if another hook run (or an earlier one) already did. */
  claim(id: string): boolean {
    mkdirSync(this.dir, { recursive: true });
    try {
      closeSync(openSync(this.file(id), 'wx'));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }
}
