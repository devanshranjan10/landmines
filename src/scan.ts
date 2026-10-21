import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildLandmines } from './analyze/landmine.js';
import { strengthRank } from './analyze/version.js';
import { type GitHubClient, GitHubError } from './github/client.js';
import { type RawIssue, canonicalRepo, searchVersionIssues } from './github/issues.js';
import type { Http } from './http.js';
import { readDependencies } from './lockfiles/index.js';
import { importNamesFor } from './pypiNames.js';
import { resolveRepo } from './registry/resolve.js';
import { INDEX_DIR, ensureIndexGitignore, readIndex, writeIndex } from './store.js';
import type { Dependency, LandmineIndex, Landmine, PackageRecord, SkippedDependency } from './types.js';
import { VERSION } from './version.js';

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ScanOptions {
  root: string;
  http: Http;
  github: GitHubClient;
  maxIssues?: number;
  refresh?: boolean;
  prod?: boolean;
  now?: () => Date;
  log?: (message: string) => void;
  /** Packages processed at once (GitHub calls are separately limited by the client). */
  concurrency?: number;
  write?: boolean;
  /** Use cached raw data of any age and never touch the network; packages without a cache are reported as errors. */
  offline?: boolean;
}

export interface ScanResult {
  index: LandmineIndex;
  skipped: SkippedDependency[];
  notes: string[];
  indexFile?: string;
  reused: number;
  /** Packages this scan tried and failed to fetch (network, registry, rate limit). Offline cache misses are not failures. */
  failed: number;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

function emptyRecord(dep: Dependency, now: Date): PackageRecord {
  return {
    ecosystem: dep.ecosystem,
    name: dep.name,
    version: dep.version,
    dev: dep.dev,
    status: 'ok',
    searchHits: 0,
    verified: 0,
    landmines: 0,
    dropped: { unverified: 0, unaffected: 0, incidental: 0 },
    fetchedAt: now.toISOString(),
  };
}

/** What scan learned from the network about one package version. Cached raw so re-analysis is free. */
interface Fetched {
  fetchedAt: string;
  maxIssues: number;
  status: PackageRecord['status'];
  detail?: string;
  repo?: string;
  repoDirectory?: string;
  searchHits: number;
  issues: RawIssue[];
}

export function cacheFile(root: string, dep: Pick<Dependency, 'ecosystem' | 'name' | 'version'>): string {
  return join(root, INDEX_DIR, 'cache', dep.ecosystem, `${encodeURIComponent(dep.name)}@${encodeURIComponent(dep.version)}.json`);
}

function readCache(file: string, now: Date, maxIssues: number, anyAge = false): Fetched | undefined {
  try {
    const f = JSON.parse(readFileSync(file, 'utf8')) as Fetched;
    if (anyAge && Array.isArray(f.issues)) return f;
    const fresh = now.getTime() - Date.parse(f.fetchedAt) < CACHE_TTL_MS;
    const enough = f.maxIssues >= maxIssues || f.issues.length < f.maxIssues;
    return fresh && enough && Array.isArray(f.issues) ? f : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(root: string, file: string, f: Fetched): void {
  mkdirSync(dirname(file), { recursive: true });
  ensureIndexGitignore(root);
  writeFileSync(file, JSON.stringify(f));
}

/** Build `.landmine/index.json`: lockfiles → registry → GitHub → verified landmines. */
export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const maxIssues = opts.maxIssues ?? 100;
  const { deps, skipped, lockfiles, notes } = readDependencies(opts.root, { prod: opts.prod ?? false });
  const searches = new Map<string, Promise<{ searchHits: number; issues: RawIssue[] }>>();
  const records: PackageRecord[] = [];
  const landmines: Landmine[] = [];
  let reused = 0;
  let fatal: GitHubError | undefined;
  // Once GitHub rate-limits us, every further package would wait and fail the same way: stop asking.
  let rateLimited: string | undefined;

  const fetchDep = async (dep: Dependency, started: Date): Promise<Fetched> => {
    const base = { fetchedAt: started.toISOString(), maxIssues, searchHits: 0, issues: [] as RawIssue[] };
    const res = await resolveRepo(opts.http, dep);
    if (res.status === 'error') throw new Error(res.detail ?? 'registry error');
    if (res.status !== 'ok' || !res.repo) return { ...base, status: res.status, ...(res.detail ? { detail: res.detail } : {}) };
    const canon = await canonicalRepo(opts.github, res.repo.owner, res.repo.name);
    if (!canon) return { ...base, status: 'no-repo', detail: `${res.repo.owner}/${res.repo.name} not found on GitHub` };
    const repoInfo = { repo: canon.fullName, ...(res.directory ? { repoDirectory: res.directory } : {}) };
    if (!canon.hasIssues) return { ...base, ...repoInfo, status: 'no-repo', detail: 'issues are disabled on the repository' };
    const key = `${canon.fullName}@${dep.version}`;
    let search = searches.get(key);
    if (!search) {
      search = searchVersionIssues(opts.github, canon.fullName, dep.version, maxIssues);
      searches.set(key, search);
    }
    const { searchHits, issues } = await search;
    return { ...base, ...repoInfo, status: 'ok', searchHits, issues, ...(canon.archived ? { detail: 'repository is archived' } : {}) };
  };

  await pool(deps, opts.concurrency ?? 4, async (dep) => {
    if (fatal) return;
    const started = now();
    const rec = emptyRecord(dep, started);
    records.push(rec);
    if (rateLimited && !opts.offline) {
      const cached = readCache(cacheFile(opts.root, dep), started, maxIssues, false);
      if (!cached) {
        rec.status = 'error';
        rec.detail = `not searched: ${rateLimited}`;
        return;
      }
    }
    if (dep.ecosystem === 'npm' && dep.name.startsWith('@types/')) {
      // DefinitelyTyped versions mirror the upstream package's, so a version search finds the runtime's issues.
      rec.status = 'skipped';
      rec.detail = 'type definitions (DefinitelyTyped)';
      return;
    }
    try {
      const file = cacheFile(opts.root, dep);
      let fetched = opts.refresh && !opts.offline ? undefined : readCache(file, started, maxIssues, opts.offline);
      if (fetched) reused++;
      else if (opts.offline) {
        rec.status = 'error';
        rec.detail = 'no cached data (offline)';
        log(`  ${dep.name}@${dep.version}: no cached data (offline)`);
        return;
      } else {
        fetched = await fetchDep(dep, started);
        if (opts.write !== false) writeCache(opts.root, file, fetched);
      }
      rec.status = fetched.status;
      rec.fetchedAt = fetched.fetchedAt;
      if (fetched.detail) rec.detail = fetched.detail;
      if (fetched.repo) rec.repo = fetched.repo;
      if (fetched.repoDirectory) rec.repoDirectory = fetched.repoDirectory;
      if (fetched.status !== 'ok' || !fetched.repo) {
        log(`  ${dep.name}@${dep.version}: ${fetched.status === 'not-github' ? 'not on GitHub' : 'no GitHub repo found'}`);
        return;
      }
      if (dep.ecosystem === 'pypi') rec.importNames = importNamesFor(dep.name, opts.root);
      const built = buildLandmines(fetched.issues, {
        ecosystem: dep.ecosystem,
        name: dep.name,
        version: dep.version,
        repo: fetched.repo,
        ...(rec.repoDirectory ? { repoDirectory: rec.repoDirectory } : {}),
        ...(rec.importNames ? { importNames: rec.importNames } : {}),
      });
      rec.searchHits = fetched.searchHits;
      rec.verified = fetched.issues.length - built.dropped.unverified;
      rec.landmines = built.landmines.length;
      rec.dropped = built.dropped;
      landmines.push(...built.landmines);
      log(`  ${dep.name}@${dep.version}: ${built.landmines.length} open issue${built.landmines.length === 1 ? '' : 's'} filed against this version`);
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'auth') {
        fatal = err;
        return;
      }
      if (err instanceof GitHubError && err.kind === 'rate-limit') rateLimited = err.message;
      rec.status = 'error';
      rec.detail = (err as Error).message;
      log(`  ${dep.name}@${dep.version}: error: ${rec.detail}`);
    }
  });
  if (fatal) throw fatal;

  // A package this scan could not fetch keeps what the previous scan found (cards included) rather than silently
  // losing its known bugs: the hook would otherwise stop warning about them after one network blip.
  const previous = readIndex(opts.root);
  let failed = 0;
  for (const rec of records) {
    if (rec.status !== 'error') continue;
    if (rec.detail !== 'no cached data (offline)') failed++;
    const prev = previous?.packages.find((p) => p.ecosystem === rec.ecosystem && p.name === rec.name && p.version === rec.version && p.status === 'ok');
    if (!prev) continue;
    const kept = (previous?.landmines ?? []).filter((l) => l.ecosystem === rec.ecosystem && l.package === rec.name && l.version === rec.version);
    landmines.push(...kept);
    Object.assign(rec, {
      repo: prev.repo,
      ...(prev.repoDirectory ? { repoDirectory: prev.repoDirectory } : {}),
      ...(prev.importNames ? { importNames: prev.importNames } : {}),
      ...(prev.fetchedAt ? { fetchedAt: prev.fetchedAt } : {}),
      searchHits: prev.searchHits,
      verified: prev.verified,
      landmines: kept.length,
      dropped: prev.dropped,
      stale: true,
      detail: `${rec.detail ?? 'fetch failed'}; kept ${kept.length} issue${kept.length === 1 ? '' : 's'} from the previous scan`,
    });
  }
  records.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  landmines.sort(
    (a, b) =>
      a.package.localeCompare(b.package) ||
      a.version.localeCompare(b.version) ||
      strengthRank(b.evidence.strength) - strengthRank(a.evidence.strength) ||
      b.issue.reactions - a.issue.reactions ||
      a.issue.number - b.issue.number,
  );
  const index: LandmineIndex = {
    schema: 1,
    generator: `landmines@${VERSION}`,
    generatedAt: now().toISOString(),
    lockfiles,
    packages: records,
    landmines,
  };
  // Keep trigger cards from the previous index for issues that have not changed since (re-carding costs model calls).
  if (previous) {
    const cards = new Map(previous.landmines.filter((l) => l.card).map((l) => [`${l.id}@${l.version}|${l.issue.updatedAt}`, l.card]));
    for (const l of landmines) {
      const card = cards.get(`${l.id}@${l.version}|${l.issue.updatedAt}`);
      if (card) l.card = card;
    }
  }
  const result: ScanResult = { index, skipped, notes, reused, failed };
  if (opts.write !== false) result.indexFile = writeIndex(opts.root, index);
  return result;
}
