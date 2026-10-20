import { dirname, join, relative } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { LockfileResult } from '../types.js';
import { DepCollector, isRecord, readText, scalar } from './common.js';

/** PEP 503 name normalization. */
export function pep503(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** Leading distribution name of a PEP 508 requirement string, normalized. */
export function pep508Name(req: string): string | undefined {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(req);
  return m?.[1] ? pep503(m[1]) : undefined;
}

const DEV_FILE = /(^|[-_/.])(dev|test|tests|testing|lint|docs?|ci)([-_/.]|$)/i;

interface RequirementsContext {
  root: string;
  out: DepCollector;
  seen: Set<string>;
  dev: boolean;
}

/** Parse a pip requirements file, following `-r` includes. Only `==`/`===` pins count. */
export function parseRequirements(path: string, root: string, source: string): LockfileResult {
  const out = new DepCollector('pypi', source);
  readRequirementsFile(path, { root, out, seen: new Set(), dev: DEV_FILE.test(relative(root, path)) });
  return out.result();
}

function readRequirementsFile(path: string, ctx: RequirementsContext): void {
  if (ctx.seen.has(path)) return;
  ctx.seen.add(path);
  const text = readText(path);
  if (text === undefined) return;
  const joined = text.replace(/\\\r?\n/g, ' ');
  for (const rawLine of joined.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const include = /^(?:-r|--requirement)(?:\s+|=)(\S+)/.exec(line);
    if (include?.[1]) {
      readRequirementsFile(join(dirname(path), include[1]), ctx);
      continue;
    }
    if (line.startsWith('-')) continue;
    parseRequirementLine(line, ctx);
  }
}

function parseRequirementLine(line: string, ctx: RequirementsContext): void {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(line);
  if (!m?.[1]) return;
  const name = pep503(m[1]);
  let rest = (m[3] ?? '').split(';')[0] ?? '';
  rest = rest.replace(/\s--\S+/g, '').trim();
  if (rest.startsWith('@')) {
    ctx.out.skip(name, rest, 'url');
    return;
  }
  const specs = rest
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const pin = specs.length === 1 ? /^===?\s*([^\s*]+)$/.exec(specs[0] ?? '') : null;
  if (pin?.[1]) ctx.out.add(name, pin[1], ctx.dev);
  else ctx.out.skip(name, rest || '*', 'unpinned');
}

type Toml = Record<string, unknown>;

function tomlFile(path: string): Toml | undefined {
  const text = readText(path);
  if (text === undefined) return undefined;
  return parseToml(text);
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** Direct dependency names from pyproject.toml, with dev flags. */
export function pyprojectDirect(pyproject: Toml | undefined): Map<string, boolean> {
  const direct = new Map<string, boolean>();
  const add = (name: string | undefined, dev: boolean): void => {
    if (!name || name === 'python') return;
    direct.set(name, (direct.get(name) ?? true) && dev);
  };
  if (!pyproject) return direct;
  const project = isRecord(pyproject.project) ? pyproject.project : {};
  for (const req of arr(project.dependencies)) if (typeof req === 'string') add(pep508Name(req), false);
  if (isRecord(project['optional-dependencies'])) {
    for (const group of Object.values(project['optional-dependencies'])) {
      for (const req of arr(group)) if (typeof req === 'string') add(pep508Name(req), false);
    }
  }
  if (isRecord(pyproject['dependency-groups'])) {
    for (const group of Object.values(pyproject['dependency-groups'])) {
      for (const req of arr(group)) if (typeof req === 'string') add(pep508Name(req), true);
    }
  }
  const tool = isRecord(pyproject.tool) ? pyproject.tool : {};
  const poetry = isRecord(tool.poetry) ? tool.poetry : {};
  if (isRecord(poetry.dependencies)) for (const n of Object.keys(poetry.dependencies)) add(pep503(n), false);
  if (isRecord(poetry['dev-dependencies'])) for (const n of Object.keys(poetry['dev-dependencies'])) add(pep503(n), true);
  if (isRecord(poetry.group)) {
    for (const [groupName, group] of Object.entries(poetry.group)) {
      if (isRecord(group) && isRecord(group.dependencies)) {
        for (const n of Object.keys(group.dependencies)) add(pep503(n), groupName !== 'main');
      }
    }
  }
  return direct;
}

interface LockedPackage {
  name: string;
  version: string;
  sourceKind: 'registry' | 'local' | 'git' | 'other';
}

function lockedPackages(lock: Toml): LockedPackage[] {
  const out: LockedPackage[] = [];
  for (const p of arr(lock.package)) {
    if (!isRecord(p) || typeof p.name !== 'string') continue;
    const src = isRecord(p.source) ? p.source : {};
    let sourceKind: LockedPackage['sourceKind'] = 'registry';
    if ('virtual' in src || 'editable' in src || 'directory' in src || 'path' in src) sourceKind = 'local';
    else if ('git' in src || src.type === 'git') sourceKind = 'git';
    else if (src.type === 'directory' || src.type === 'file') sourceKind = 'local';
    else if ('url' in src && !('registry' in src) && src.type !== 'legacy') sourceKind = 'other';
    out.push({ name: pep503(p.name), version: scalar(p.version) ?? '', sourceKind });
  }
  return out;
}

function addLocked(out: DepCollector, name: string, dev: boolean, locked: LockedPackage[], pinned?: string): void {
  const matches = locked.filter((p) => p.name === name && (pinned === undefined || p.version === pinned));
  if (matches.length === 0) {
    out.skip(name, pinned ?? '*', 'missing');
    return;
  }
  for (const p of matches) {
    if (p.sourceKind === 'local') out.skip(name, p.version, 'workspace');
    else if (p.sourceKind === 'git') out.skip(name, p.version, 'git');
    else if (p.sourceKind === 'other' || !p.version) out.skip(name, p.version, 'url');
    else out.add(name, p.version, dev);
  }
}

/** poetry.lock + pyproject.toml. */
export function parsePoetryLock(lockPath: string, pyprojectPath: string, source: string): LockfileResult {
  const out = new DepCollector('pypi', source);
  const lock = tomlFile(lockPath) ?? {};
  const locked = lockedPackages(lock);
  for (const [name, dev] of pyprojectDirect(tomlFile(pyprojectPath))) addLocked(out, name, dev, locked);
  return out.result();
}

/** uv.lock: direct deps are those of local (virtual/editable) packages. */
export function parseUvLock(lockPath: string, source: string): LockfileResult {
  const out = new DepCollector('pypi', source);
  const lock = tomlFile(lockPath) ?? {};
  const locked = lockedPackages(lock);
  const localNames = new Set(locked.filter((p) => p.sourceKind === 'local').map((p) => p.name));
  for (const p of arr(lock.package)) {
    if (!isRecord(p) || typeof p.name !== 'string' || !localNames.has(pep503(p.name))) continue;
    const visit = (list: unknown, dev: boolean): void => {
      for (const d of arr(list)) {
        if (!isRecord(d) || typeof d.name !== 'string') continue;
        const name = pep503(d.name);
        if (localNames.has(name)) {
          out.skip(name, 'local', 'workspace');
          continue;
        }
        addLocked(out, name, dev, locked, typeof d.version === 'string' ? d.version : undefined);
      }
    };
    visit(p.dependencies, false);
    if (isRecord(p['optional-dependencies'])) for (const g of Object.values(p['optional-dependencies'])) visit(g, false);
    if (isRecord(p['dev-dependencies'])) for (const g of Object.values(p['dev-dependencies'])) visit(g, true);
  }
  return out.result();
}

/** Pipfile.lock (+ Pipfile for which names are direct). */
export function parsePipfileLock(lockPath: string, pipfilePath: string, source: string): LockfileResult {
  const out = new DepCollector('pypi', source);
  const lockText = readText(lockPath);
  if (lockText === undefined) return out.result();
  const lock: unknown = JSON.parse(lockText);
  if (!isRecord(lock)) return out.result();
  const pipfile = tomlFile(pipfilePath);
  const sections: Array<[string, string, boolean]> = [
    ['default', 'packages', false],
    ['develop', 'dev-packages', true],
  ];
  for (const [lockKey, pipKey, dev] of sections) {
    const entries = isRecord(lock[lockKey]) ? lock[lockKey] : {};
    const declared = pipfile && isRecord(pipfile[pipKey]) ? new Set(Object.keys(pipfile[pipKey]).map(pep503)) : undefined;
    for (const [rawName, value] of Object.entries(entries)) {
      const name = pep503(rawName);
      if (declared && !declared.has(name)) continue;
      const version = isRecord(value) && typeof value.version === 'string' ? value.version.replace(/^===?/, '') : undefined;
      if (!version) out.skip(name, 'vcs', 'git');
      else out.add(name, version, dev);
    }
  }
  return out.result();
}
