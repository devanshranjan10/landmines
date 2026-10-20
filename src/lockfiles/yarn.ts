import { join } from 'node:path';
import { load } from 'js-yaml';
import type { LockfileResult } from '../types.js';
import {
  DepCollector,
  NPM_DEP_FIELDS,
  type PackageJson,
  expandWorkspaceDirs,
  isRecord,
  nonRegistryReason,
  readPackageJson,
  scalar,
  splitAt,
  stringRecord,
  workspacePatterns,
} from './common.js';

interface YarnEntry {
  version?: string;
  resolution?: string;
  dependencies?: Record<string, string>;
}

/** Split a comma-joined yarn key list, honoring double quotes. */
export function splitKeys(raw: string): string[] {
  const keys: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      keys.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) keys.push(cur.trim());
  return keys.filter(Boolean);
}

/** Minimal yarn v1 lockfile parser: top-level entries and their `version`. */
export function parseYarnV1(text: string): Map<string, YarnEntry> {
  const map = new Map<string, YarnEntry>();
  let current: YarnEntry | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      const header = line.replace(/:\s*$/, '');
      current = {};
      for (const key of splitKeys(header)) map.set(key, current);
      continue;
    }
    const m = /^ {2}version "?([^"\s]+)"?\s*$/.exec(line);
    if (m && current) current.version = m[1];
  }
  return map;
}

function parseBerry(text: string): Map<string, YarnEntry> {
  const doc = load(text);
  const map = new Map<string, YarnEntry>();
  if (!isRecord(doc)) return map;
  for (const [rawKey, value] of Object.entries(doc)) {
    if (rawKey === '__metadata' || !isRecord(value)) continue;
    const e: YarnEntry = {
      version: scalar(value.version),
      resolution: typeof value.resolution === 'string' ? value.resolution : undefined,
      dependencies: stringRecord(value.dependencies),
    };
    for (const key of splitKeys(rawKey)) map.set(key, e);
  }
  return map;
}

/** Parse yarn.lock (classic v1 or berry). Direct deps come from package.json manifests. */
export function parseYarnLock(text: string, root: string, rootPkg: PackageJson | undefined, source: string): LockfileResult {
  const out = new DepCollector('npm', source);
  const berry = /^__metadata:/m.test(text);
  const entries = berry ? parseBerry(text) : parseYarnV1(text);

  const manifests: PackageJson[] = [];
  if (rootPkg) manifests.push(rootPkg);
  for (const dir of expandWorkspaceDirs(root, workspacePatterns(rootPkg))) {
    const pkg = readPackageJson(join(root, dir));
    if (pkg) manifests.push(pkg);
  }

  for (const pkg of manifests) {
    for (const field of NPM_DEP_FIELDS) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        const dev = field === 'devDependencies';
        const local = nonRegistryReason(range);
        if (local && !range.startsWith('npm:')) {
          out.skip(name, range, local);
          continue;
        }
        const descriptor = berry && !/^[a-z]+:/.test(range) ? `${name}@npm:${range}` : `${name}@${range}`;
        const e = entries.get(descriptor);
        if (!e?.version) {
          if (field !== 'peerDependencies' && field !== 'optionalDependencies') out.skip(name, range, 'missing');
          continue;
        }
        const realName = berry ? berryRealName(e.resolution, name) : v1RealName(range, name);
        if (realName === undefined) {
          out.skip(name, range, 'unsupported');
          continue;
        }
        out.add(realName, e.version, dev);
      }
    }
  }
  return out.result();
}

function v1RealName(range: string, name: string): string | undefined {
  if (!range.startsWith('npm:')) return name;
  return splitAt(range.slice(4))?.name;
}

/** `debug@npm:4.4.3` → debug; `resolve@patch:resolve@npm%3A…` → resolve; workspaces/links → undefined. */
function berryRealName(resolution: string | undefined, fallback: string): string | undefined {
  if (!resolution) return fallback;
  const parts = splitAt(resolution);
  if (!parts) return fallback;
  if (parts.rest.startsWith('npm:') || parts.rest.startsWith('patch:')) return parts.name;
  return undefined;
}

