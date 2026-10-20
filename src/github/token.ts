import { execFile } from 'node:child_process';

export interface TokenSource {
  token: string;
  source: 'GITHUB_TOKEN' | 'GH_TOKEN' | 'gh auth token';
}

type Exec = (cmd: string, args: string[]) => Promise<string>;

const execGh: Exec = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => (err ? reject(new Error(err.message)) : resolve(stdout)));
  });

/** GITHUB_TOKEN, then GH_TOKEN, then the GitHub CLI's stored token. */
export async function findToken(env: NodeJS.ProcessEnv = process.env, exec: Exec = execGh): Promise<TokenSource | undefined> {
  if (env.GITHUB_TOKEN?.trim()) return { token: env.GITHUB_TOKEN.trim(), source: 'GITHUB_TOKEN' };
  if (env.GH_TOKEN?.trim()) return { token: env.GH_TOKEN.trim(), source: 'GH_TOKEN' };
  try {
    const out = (await exec('gh', ['auth', 'token'])).trim();
    if (out) return { token: out, source: 'gh auth token' };
  } catch {
    // gh missing or not logged in
  }
  return undefined;
}
