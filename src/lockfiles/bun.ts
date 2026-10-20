import type { LockfileResult } from '../types.js';
import { parseJsonc } from '../util/jsonc.js';
import { DepCollector, NPM_DEP_FIELDS, isRecord, nonRegistryReason, splitAt, stringRecord } from './common.js';

/** Parse bun.lock (text format, Bun ≥ 1.2). The binary bun.lockb is not supported. */
export function parseBunLock(text: string, source: string): LockfileResult {
  const lock = parseJsonc(text);
  if (!isRecord(lock)) throw new Error(`${source}: not a JSON object`);
  const out = new DepCollector('npm', source);
  const workspaces = isRecord(lock.workspaces) ? lock.workspaces : {};
  const packages = isRecord(lock.packages) ? lock.packages : {};

  for (const [path, wsValue] of Object.entries(workspaces)) {
    if (!isRecord(wsValue)) continue;
    const wsName = typeof wsValue.name === 'string' ? wsValue.name : undefined;
    for (const field of NPM_DEP_FIELDS) {
      for (const [name, range] of Object.entries(stringRecord(wsValue[field]))) {
        const local = nonRegistryReason(range);
        if (local === 'workspace' || local === 'link' || local === 'file') {
          out.skip(name, range, local);
          continue;
        }
        const scoped = path !== '' && wsName ? packages[`${wsName}/${name}`] : undefined;
        const entry = scoped ?? packages[name];
        const ident = Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : undefined;
        if (!ident) {
          if (field !== 'peerDependencies' && field !== 'optionalDependencies') out.skip(name, range, 'missing');
          continue;
        }
        const parts = splitAt(ident);
        if (!parts) {
          out.skip(name, range, 'unsupported');
          continue;
        }
        const reason = nonRegistryReason(parts.rest);
        if (reason) {
          out.skip(name, range, reason);
          continue;
        }
        out.add(parts.name, parts.rest, field === 'devDependencies');
      }
    }
  }
  return out.result();
}
