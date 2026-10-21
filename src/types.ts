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

export type Strength = 'strong' | 'medium' | 'weak';
export type MentionKind = 'template' | 'adjacent' | 'plain' | 'range' | 'url';
export type SymbolSource = 'title' | 'span' | 'code' | 'import';

export interface VersionEvidence {
  strength: Strength;
  where: 'title' | 'body' | 'comment';
  kind: MentionKind;
  /** Short excerpt around the version mention. */
  quote: string;
  /** Comment author when the evidence is a comment. */
  by?: string;
  /** Why the strength was lowered, if it was. */
  notes?: string[];
}

export interface IssueSymbol {
  /** Identifier, `a.b` pair, or deep import path (`next/dynamic`). */
  name: string;
  score: number;
  sources: SymbolSource[];
}

export interface Workaround {
  /** `workaround`: the text says it works around the bug. `top-reply`: highest-signal reply with code, no explicit claim. */
  kind: 'workaround' | 'top-reply';
  author: string;
  association: string;
  url: string;
  createdAt: string;
  reactions: number;
  excerpt: string;
  signals: string[];
  caution?: string;
}

export interface FixHint {
  text: string;
  url: string;
  author: string;
}

export interface Landmine {
  /** `owner/repo#123` */
  id: string;
  ecosystem: Ecosystem;
  package: string;
  version: string;
  issue: {
    number: number;
    title: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    author: string;
    labels: string[];
    reactions: number;
    comments: number;
  };
  evidence: VersionEvidence;
  symbols: IssueSymbol[];
  /** Databases the issue is specific to (from title and labels), e.g. ["mysql"]. */
  dialects?: string[];
  /** A feature request, question, docs or install issue rather than a bug report. Never arms the hook. */
  nonBug?: true;
  workaround?: Workaround;
  fixHint?: FixHint;
  /** LLM-written trigger card (`landmine cards`). When present it decides when the hook fires. */
  card?: TriggerCard;
}

/**
 * What an LLM read out of the issue thread, once, at scan time: the API the bug is in and the condition that makes it
 * fire. The hook checks it offline (D-34). Strings are untrusted model output over untrusted issue text.
 */
export interface TriggerCard {
  /** False for feature requests, questions, docs, intended behaviour and user error. */
  isBug: boolean;
  /** Does the bug affect the pinned version, per the thread? */
  affectsPinned: 'yes' | 'likely' | 'no' | 'unknown';
  /** Names the edit must touch: functions, methods, classes, options (`add`, `Duration.add`, `use_enum_values`). */
  apis: string[];
  /** AND of OR-groups of tokens the edited file must also contain (identifiers, option keys, string contents). */
  requires: string[][];
  /** One line: what goes wrong, and when. */
  condition: string;
  /** One or two lines: how to avoid it at this version. */
  workaround?: string;
  /** Comment the workaround comes from. */
  workaroundUrl?: string;
  confidence: number;
  provider: string;
  model: string;
  promptVersion: number;
}

export interface PackageRecord {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  dev: boolean;
  repo?: string;
  repoDirectory?: string;
  /** PyPI only: top-level import names (bs4 for beautifulsoup4). */
  importNames?: string[];
  status: 'ok' | 'no-repo' | 'not-github' | 'skipped' | 'error';
  detail?: string;
  searchHits: number;
  verified: number;
  landmines: number;
  dropped: { unverified: number; unaffected: number; incidental: number };
  fetchedAt?: string;
}

export interface LandmineIndex {
  schema: 1;
  generator: string;
  generatedAt: string;
  lockfiles: string[];
  packages: PackageRecord[];
  landmines: Landmine[];
}
