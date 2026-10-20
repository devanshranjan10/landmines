export type Ecosystem = 'npm' | 'pypi';

/** A direct dependency resolved to the exact version the lockfile pins. */
export interface Dependency {
  ecosystem: Ecosystem;
  /** Registry name. npm names as published; PyPI names PEP 503-normalized. */
  name: string;
  version: string;
  /** True only when every place that declares it is a dev/test group. */
  dev: boolean;
  /** Lockfile path relative to the project root. */
  source: string;
}

export type SkipReason = 'link' | 'workspace' | 'git' | 'file' | 'url' | 'unpinned' | 'missing' | 'unsupported';

/** A declared dependency landmine cannot look up on a registry. */
export interface SkippedDependency {
  ecosystem: Ecosystem;
  name: string;
  spec: string;
  reason: SkipReason;
  source: string;
}

export interface LockfileResult {
  deps: Dependency[];
  skipped: SkippedDependency[];
}
