import { loadAll } from 'js-yaml';
import type { LockfileResult, SkipReason } from '../types.js';
import { DepCollector, isRecord, nonRegistryReason, scalar, splitAt } from './common.js';

const FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies'] as const;

/** Parse pnpm-lock.yaml (lockfileVersion 5.4, 6.0, 9.0). Uses the last YAML document. */
export function parsePnpmLock(text: string, source: string): LockfileResult {
  const docs = loadAll(text).filter(isRecord);
  const doc = docs.at(-1);
  if (!doc) throw new Error(`${source}: empty pnpm lockfile`);
  const v5 = (scalar(doc.lockfileVersion) ?? '').startsWith('5');
  const out = new DepCollector('npm', source);

  const importers: Record<string, unknown> = isRecord(doc.importers) ? doc.importers : { '.': doc };
  for (const imp of Object.values(importers)) {
    if (!isRecord(imp)) continue;
    const specifiers = isRecord(imp.specifiers) ? imp.specifiers : {};
    for (const field of FIELDS) {
      const deps = imp[field];
      if (!isRecord(deps)) continue;
      for (const [name, value] of Object.entries(deps)) {
        const version = typeof value === 'string' ? value : isRecord(value) ? (scalar(value.version) ?? '') : '';
        const spec =
          isRecord(value) && typeof value.specifier === 'string'
            ? value.specifier
            : typeof specifiers[name] === 'string'
              ? specifiers[name]
              : version;
        const resolved = normalizeVersion(name, version, v5);
        if ('reason' in resolved) out.skip(name, spec, spec.startsWith('workspace:') ? 'workspace' : resolved.reason);
        else out.add(resolved.name, resolved.version, field === 'devDependencies');
      }
    }
  }
  return out.result();
}

type Normalized = { name: string; version: string } | { reason: SkipReason };

export function normalizeVersion(name: string, raw: string, v5: boolean): Normalized {
  let v = raw.split('(')[0]?.trim() ?? '';
  if (!v) return { reason: 'missing' };
  const reason = nonRegistryReason(v);
  if (reason) return { reason };
  if (v5) v = v.split('_')[0] ?? v;
  if (v.startsWith('/')) {
    v = v.slice(1);
    if (v5) {
      // v5 alias: /chalk/4.1.2 or /@scope/name/1.0.0
      const slash = v.lastIndexOf('/');
      if (slash <= 0) return { reason: 'url' };
      return { name: v.slice(0, slash), version: v.slice(slash + 1) };
    }
  }
  const parts = splitAt(v);
  if (parts) return { name: parts.name, version: parts.rest };
  if (v.includes('/')) return { reason: 'url' };
  return { name, version: v };
}
