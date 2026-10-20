export interface RepoRef {
  owner: string;
  name: string;
}

const RESERVED = new Set([
  'sponsors',
  'orgs',
  'users',
  'apps',
  'marketplace',
  'topics',
  'settings',
  'features',
  'about',
  'enterprise',
  'login',
  'site',
  'collections',
  'explore',
  'notifications',
  'pulls',
  'issues',
  'search',
  'security',
  'advisories',
]);

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

function fromPath(path: string): RepoRef | undefined {
  const clean = path.replace(/^\/+/, '').split(/[?#]/)[0] ?? '';
  const [owner, rawName] = clean.split('/');
  const name = rawName?.replace(/\.git$/, '');
  if (!owner || !name || !SEGMENT.test(owner) || !SEGMENT.test(name) || RESERVED.has(owner.toLowerCase())) return undefined;
  if (name === '.' || name === '..') return undefined;
  return { owner, name };
}

/**
 * Extract a GitHub owner/repo from any repository-ish value found in npm or PyPI
 * metadata: objects with `url`, `github:` shorthand, bare `owner/repo`, https, git+https,
 * git://, git+ssh://, ssh://, scp-style `git@github.com:o/r.git`, deep links into the repo.
 */
export function parseGitHubRepo(value: unknown): RepoRef | undefined {
  let raw: unknown = value;
  if (typeof raw === 'object' && raw !== null && 'url' in raw) raw = (raw).url;
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;

  const shorthand = /^github:(.+)$/i.exec(s);
  if (shorthand?.[1]) return fromPath(shorthand[1]);
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) return fromPath(s);

  const scp = /^[\w.-]+@(?:www\.)?github\.com:(.+)$/i.exec(s);
  if (scp?.[1]) return fromPath(scp[1]);

  const url = /^(?:git\+)?(?:https?|git|ssh|git\+ssh):\/\/(?:[^@/]+@)?(?:www\.)?github\.com(?::\d+)?\/(.+)$/i.exec(s);
  if (url?.[1]) return fromPath(url[1]);
  return undefined;
}

/** Does this look like a repository on some other forge (GitLab, Bitbucket, Codeberg, …)? */
export function looksLikeOtherForge(value: unknown): boolean {
  let raw: unknown = value;
  if (typeof raw === 'object' && raw !== null && 'url' in raw) raw = (raw).url;
  return typeof raw === 'string' && /(gitlab|bitbucket|codeberg|sr\.ht|gitee|sourceforge|git\.)/i.test(raw);
}
