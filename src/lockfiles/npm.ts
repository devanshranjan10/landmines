import type { LockfileResult } from '../types.js';
import {
  DepCollector,
  NPM_DEP_FIELDS,
  type PackageJson,
  isRecord,
  matchWorkspaces,
  nonRegistryReason,
  splitAt,
  stringRecord,
  workspacePatterns,
} from './common.js';

interface LockEntry {
  version?: string;
  name?: string;
  resolved?: string;
  link?: boolean;
}

function entry(value: unknown): LockEntry | undefined {
  if (!isRecord(value)) return undefined;
  return {
    version: typeof value.version === 'string' ? value.version : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    resolved: typeof value.resolved === 'string' ? value.resolved : undefined,
    link: value.link === true,
  };
}

/**
 * Parse package-lock.json / npm-shrinkwrap.json (lockfileVersion 1, 2, 3).
 * `rootPkg` is the project's package.json; v1 lockfiles do not record direct deps.
 */
export function parseNpmLock(text: string, rootPkg: PackageJson | undefined, source: string): LockfileResult {
  const lock: unknown = JSON.parse(text);
  if (!isRecord(lock)) throw new Error(`${source}: not a JSON object`);
  const out = new DepCollector('npm', source);
  if (isRecord(lock.packages)) parsePackagesSection(lock.packages, out);
  else parseV1(lock, rootPkg, out);
  return out.result();
}

function parsePackagesSection(packages: Record<string, unknown>, out: DepCollector): void {
  const root = isRecord(packages['']) ? packages[''] : {};
  const patterns = workspacePatterns(root);
  const workspaceKeys = matchWorkspaces(
    patterns,
    Object.keys(packages).filter((k) => k !== '' && !k.includes('node_modules/') && !k.startsWith('..')),
  );
  for (const importer of ['', ...workspaceKeys]) {
    const imp = packages[importer];
    if (!isRecord(imp)) continue;
    for (const field of NPM_DEP_FIELDS) {
      for (const [name, spec] of Object.entries(stringRecord(imp[field]))) {
        const resolvedEntry = lookup(packages, importer, name);
        if (!resolvedEntry) {
          // Uninstalled peers and optional deps for other platforms are normal.
          if (field !== 'peerDependencies' && field !== 'optionalDependencies') out.skip(name, spec, 'missing');
          continue;
        }
        if (resolvedEntry.link) {
          out.skip(name, spec, spec.startsWith('file:') ? 'file' : 'workspace');
          continue;
        }
        // Tarball URLs from any registry are fine; only git and file resolutions are not registry versions.
        const resolvedReason = resolvedEntry.resolved ? nonRegistryReason(resolvedEntry.resolved) : undefined;
        const reason = nonRegistryReason(spec) ?? (resolvedReason === 'git' || resolvedReason === 'file' ? resolvedReason : undefined);
        if (reason && !spec.startsWith('npm:')) {
          out.skip(name, spec, reason);
          continue;
        }
        if (!resolvedEntry.version) {
          out.skip(name, spec, 'missing');
          continue;
        }
        out.add(resolvedEntry.name ?? name, resolvedEntry.version, field === 'devDependencies');
      }
    }
  }
}

/** Node resolution: nearest node_modules walking up from the importer. */
function lookup(packages: Record<string, unknown>, importer: string, name: string): LockEntry | undefined {
  const segments = importer ? importer.split('/') : [];
  for (let i = segments.length; i >= 0; i--) {
    const base = segments.slice(0, i).join('/');
    const key = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    const found = entry(packages[key]);
    if (found) return found;
  }
  return undefined;
}

function parseV1(lock: Record<string, unknown>, rootPkg: PackageJson | undefined, out: DepCollector): void {
  const deps = isRecord(lock.dependencies) ? lock.dependencies : {};
  if (!rootPkg) return;
  for (const field of NPM_DEP_FIELDS) {
    for (const [name, spec] of Object.entries(rootPkg[field] ?? {})) {
      const e = entry(deps[name]);
      if (!e?.version) {
        if (field !== 'peerDependencies' && field !== 'optionalDependencies') out.skip(name, spec, 'missing');
        continue;
      }
      let realName = name;
      let version = e.version;
      if (version.startsWith('npm:')) {
        const parts = splitAt(version.slice(4));
        if (!parts) {
          out.skip(name, spec, 'unsupported');
          continue;
        }
        realName = parts.name;
        version = parts.rest;
      }
      const reason = nonRegistryReason(version);
      if (reason) {
        out.skip(name, spec, reason);
        continue;
      }
      out.add(realName, version, field === 'devDependencies');
    }
  }
}
