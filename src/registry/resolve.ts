import type { Http } from '../http.js';
import type { Dependency } from '../types.js';
import { USER_AGENT } from '../version.js';
import { type RepoRef, looksLikeOtherForge, parseGitHubRepo } from './repoUrl.js';

export interface RepoResolution {
  status: 'ok' | 'no-repo' | 'not-github' | 'error';
  repo?: RepoRef;
  /** npm `repository.directory`: the package lives in a monorepo subdirectory. */
  directory?: string;
  detail?: string;
}

async function getJson(http: Http, url: string): Promise<{ status: number; json?: unknown }> {
  const res = await http.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  if (!res.ok) return { status: res.status };
  return { status: res.status, json: (await res.json()) };
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function npmMetadataUrl(name: string, version: string): string {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  return `https://registry.npmjs.org/${encoded}/${encodeURIComponent(version)}`;
}

export async function resolveNpmRepo(http: Http, name: string, version: string): Promise<RepoResolution> {
  const { status, json } = await getJson(http, npmMetadataUrl(name, version));
  if (status === 404) return { status: 'no-repo', detail: `${name}@${version} not found on registry.npmjs.org` };
  if (!json) return { status: 'error', detail: `registry.npmjs.org returned ${status}` };
  const meta = obj(json);
  const repository = meta.repository;
  const candidates = [repository, obj(meta.bugs).url ?? meta.bugs, meta.homepage];
  for (const c of candidates) {
    const repo = parseGitHubRepo(c);
    if (repo) {
      const directory = obj(repository).directory;
      return { status: 'ok', repo, ...(typeof directory === 'string' && directory ? { directory } : {}) };
    }
  }
  if (repository && looksLikeOtherForge(repository)) {
    const url = typeof repository === 'string' ? repository : obj(repository).url;
    return { status: 'not-github', ...(typeof url === 'string' ? { detail: url } : {}) };
  }
  return { status: 'no-repo', detail: 'no repository, bugs or homepage URL points at GitHub' };
}

/** PEP 753 label normalization. */
function normLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SOURCE_LABELS = ['source', 'sourcecode', 'repository', 'repo', 'github', 'code'];
const ISSUE_LABELS = ['issues', 'issue', 'bugs', 'bug', 'tracker', 'issuetracker', 'bugtracker', 'bugreports'];
const HOME_LABELS = ['homepage', 'home'];
const REJECT_LABELS = /fund|sponsor|donat|changelog|release|docs|documentation/;

export async function resolvePypiRepo(http: Http, name: string, version: string): Promise<RepoResolution> {
  let { status, json } = await getJson(http, `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`);
  if (status === 404) ({ status, json } = await getJson(http, `https://pypi.org/pypi/${encodeURIComponent(name)}/json`));
  if (status === 404) return { status: 'no-repo', detail: `${name} not found on pypi.org` };
  if (!json) return { status: 'error', detail: `pypi.org returned ${status}` };
  const info = obj(obj(json).info);
  const urls = Object.entries(obj(info.project_urls))
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .map(([label, url]) => ({ label: normLabel(label), url }));
  const ordered = [
    ...urls.filter((u) => SOURCE_LABELS.includes(u.label)),
    ...urls.filter((u) => ISSUE_LABELS.includes(u.label)),
    ...urls.filter((u) => HOME_LABELS.includes(u.label)),
    ...(typeof info.home_page === 'string' ? [{ label: 'homepage', url: info.home_page }] : []),
    ...urls.filter((u) => ![...SOURCE_LABELS, ...ISSUE_LABELS, ...HOME_LABELS].includes(u.label) && !REJECT_LABELS.test(u.label)),
  ];
  for (const u of ordered) {
    const repo = parseGitHubRepo(u.url);
    if (repo) return { status: 'ok', repo };
  }
  if (ordered.some((u) => looksLikeOtherForge(u.url))) return { status: 'not-github', detail: ordered.find((u) => looksLikeOtherForge(u.url))?.url };
  return { status: 'no-repo', detail: 'no project URL points at a GitHub repository' };
}

export function resolveRepo(http: Http, dep: Dependency): Promise<RepoResolution> {
  return dep.ecosystem === 'npm' ? resolveNpmRepo(http, dep.name, dep.version) : resolvePypiRepo(http, dep.name, dep.version);
}
