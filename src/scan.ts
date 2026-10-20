import { buildLandmines } from './analyze/landmine.js';
import { strengthRank } from './analyze/version.js';
import { type GitHubClient, GitHubError } from './github/client.js';
import { type RawIssue, canonicalRepo, searchVersionIssues } from './github/issues.js';
import type { Http } from './http.js';
import { readDependencies } from './lockfiles/index.js';
import { importNamesFor } from './pypiNames.js';
import { resolveRepo } from './registry/resolve.js';
import { readIndex, writeIndex } from './store.js';
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
}

export interface ScanResult {
  index: LandmineIndex;
  skipped: SkippedDependency[];
  notes: string[];
  indexFile?: string;
  reused: number;
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

/** Build `.landmine/index.json`: lockfiles → registry → GitHub → verified landmines. */
export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const maxIssues = opts.maxIssues ?? 100;
  const { deps, skipped, lockfiles, notes } = readDependencies(opts.root, { prod: opts.prod ?? false });
  const previous = opts.refresh ? undefined : readIndex(opts.root);
  const searches = new Map<string, Promise<{ searchHits: number; issues: RawIssue[] }>>();
  const records: PackageRecord[] = [];
  const landmines: Landmine[] = [];
  let reused = 0;
  let fatal: GitHubError | undefined;

  await pool(deps, opts.concurrency ?? 4, async (dep) => {
    if (fatal) return;
    const started = now();
    const cached = previous?.packages.find(
      (p) => p.ecosystem === dep.ecosystem && p.name === dep.name && p.version === dep.version && p.status !== 'error',
    );
    if (cached?.fetchedAt && started.getTime() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
      records.push({ ...cached, dev: dep.dev });
      landmines.push(...(previous?.landmines ?? []).filter((l) => l.ecosystem === dep.ecosystem && l.package === dep.name && l.version === dep.version));
      reused++;
      return;
    }

    const rec = emptyRecord(dep, started);
    records.push(rec);
    if (dep.ecosystem === 'npm' && dep.name.startsWith('@types/')) {
      // DefinitelyTyped versions mirror the upstream package's, so a version search finds the runtime's issues.
      rec.status = 'skipped';
      rec.detail = 'type definitions (DefinitelyTyped)';
      return;
    }
    try {
      const res = await resolveRepo(opts.http, dep);
      if (res.status !== 'ok' || !res.repo) {
        rec.status = res.status === 'error' ? 'error' : res.status;
        if (res.detail) rec.detail = res.detail;
        log(`  ${dep.name}@${dep.version}: ${res.status === 'not-github' ? 'not on GitHub' : 'no GitHub repo found'}`);
        return;
      }
      const canon = await canonicalRepo(opts.github, res.repo.owner, res.repo.name);
      if (!canon) {
        rec.status = 'no-repo';
        rec.detail = `${res.repo.owner}/${res.repo.name} not found on GitHub`;
        return;
      }
      rec.repo = canon.fullName;
      if (res.directory) rec.repoDirectory = res.directory;
      if (canon.archived) rec.detail = 'repository is archived';
      if (!canon.hasIssues) {
        rec.status = 'no-repo';
        rec.detail = 'issues are disabled on the repository';
        return;
      }
      if (dep.ecosystem === 'pypi') rec.importNames = importNamesFor(dep.name, opts.root);

      const key = `${canon.fullName}@${dep.version}`;
      let search = searches.get(key);
      if (!search) {
        search = searchVersionIssues(opts.github, canon.fullName, dep.version, maxIssues);
        searches.set(key, search);
      }
      const { searchHits, issues } = await search;
      const built = buildLandmines(issues, {
        ecosystem: dep.ecosystem,
        name: dep.name,
        version: dep.version,
        repo: canon.fullName,
        ...(rec.repoDirectory ? { repoDirectory: rec.repoDirectory } : {}),
        ...(rec.importNames ? { importNames: rec.importNames } : {}),
      });
      rec.searchHits = searchHits;
      rec.verified = issues.length - built.dropped.unverified;
      rec.landmines = built.landmines.length;
      rec.dropped = built.dropped;
      landmines.push(...built.landmines);
      log(`  ${dep.name}@${dep.version}: ${built.landmines.length} open issue${built.landmines.length === 1 ? '' : 's'} filed against this version`);
    } catch (err) {
      if (err instanceof GitHubError && err.kind === 'auth') {
        fatal = err;
        return;
      }
      rec.status = 'error';
      rec.detail = (err as Error).message;
      log(`  ${dep.name}@${dep.version}: error: ${rec.detail}`);
    }
  });
  if (fatal) throw fatal;

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
  const result: ScanResult = { index, skipped, notes, reused };
  if (opts.write !== false) result.indexFile = writeIndex(opts.root, index);
  return result;
}
