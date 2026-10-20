import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Dependency, Ecosystem, LockfileResult, SkipReason, SkippedDependency } from '../types.js';

export interface PackageJson {
  name?: string;
  version?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

export const NPM_DEP_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies'] as const;
export type NpmDepField = (typeof NPM_DEP_FIELDS)[number];

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

export function readPackageJson(dir: string): PackageJson | undefined {
  const text = readText(join(dir, 'package.json'));
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A YAML/TOML scalar as a string (numbers like `5.4` or `10` included). */
export function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return undefined;
}

export function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Split `name@spec` at the first `@` after index 0, so scoped names survive. */
export function splitAt(ident: string): { name: string; rest: string } | undefined {
  const at = ident.indexOf('@', 1);
  if (at <= 0) return undefined;
  return { name: ident.slice(0, at), rest: ident.slice(at + 1) };
}

/** Classify a non-registry npm spec or resolved version; undefined means "looks like a registry version". */
export function nonRegistryReason(spec: string): SkipReason | undefined {
  if (/^workspace:/.test(spec)) return 'workspace';
  if (/^(link|portal):/.test(spec)) return 'link';
  if (/^file:/.test(spec)) return 'file';
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(spec) || /^[\w-]+\/[\w.-]+(#.*)?$/.test(spec)) return 'git';
  if (spec.includes('://')) return 'url';
  return undefined;
}

export function workspacePatterns(pkg: PackageJson | undefined): string[] {
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) return ws.filter((p): p is string => typeof p === 'string');
  if (ws && Array.isArray(ws.packages)) return ws.packages;
  return [];
}

function globToRegExp(pattern: string): RegExp {
  const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');
  let re = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] ?? '';
    if (ch === '*') {
      if (clean[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Paths (relative, `/`-separated) that match any workspace glob. */
export function matchWorkspaces(patterns: string[], paths: Iterable<string>): string[] {
  const res = patterns.filter((p) => !p.startsWith('!')).map(globToRegExp);
  const out: string[] = [];
  for (const p of paths) if (res.some((r) => r.test(p))) out.push(p);
  return out;
}

/** Expand workspace globs against the filesystem; returns relative dirs that hold a package.json. */
export function expandWorkspaceDirs(root: string, patterns: string[]): string[] {
  const found: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(join(root, rel));
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${e}` : e;
      let isDir: boolean;
      try {
        isDir = statSync(join(root, childRel)).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (existsSync(join(root, childRel, 'package.json'))) found.push(childRel);
      walk(childRel, depth + 1);
    }
  };
  if (patterns.length > 0) walk('', 0);
  return matchWorkspaces(patterns, found);
}

/** Accumulates deps, deduping by (ecosystem, name, version); prod wins over dev. */
export class DepCollector {
  private readonly byKey = new Map<string, Dependency>();
  readonly skipped: SkippedDependency[] = [];

  constructor(
    private readonly ecosystem: Ecosystem,
    private readonly source: string,
  ) {}

  add(name: string, version: string, dev: boolean): void {
    const key = `${name}@${version}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.dev = existing.dev && dev;
      return;
    }
    this.byKey.set(key, { ecosystem: this.ecosystem, name, version, dev, source: this.source });
  }

  skip(name: string, spec: string, reason: SkipReason): void {
    if (this.skipped.some((s) => s.name === name && s.spec === spec)) return;
    this.skipped.push({ ecosystem: this.ecosystem, name, spec, reason, source: this.source });
  }

  result(): LockfileResult {
    const deps = [...this.byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
    return { deps, skipped: this.skipped };
  }
}
