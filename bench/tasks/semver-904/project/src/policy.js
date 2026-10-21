import semver from 'semver';

/** Allowed version ranges per package, maintained by the platform team. */
export const POLICIES = {
  lodash: '^4.17.0 >=4.17.21',
  express: '^4.18.0 <4.21.0',
  react: '^18.2.0 || ^19.0.0',
  typescript: '~5.4.0 || ~5.6.0',
  axios: '^1.6.0',
};

/** True if `version` is allowed by `range`. */
export function isAllowed(version, range) {
  return semver.satisfies(version, range);
}

/**
 * Where an installed `version` sits relative to the allowed `range`:
 * 'ok' | 'too-old' | 'too-new' | 'excluded'.
 */
export function classify(version, range) {
  throw new Error('not implemented');
}

/** Report rows for a lockfile's `{ name: version }` map, only for packages that have a policy. */
export function report(installed) {
  return Object.entries(installed)
    .filter(([name]) => name in POLICIES)
    .map(([name, version]) => ({ name, version, range: POLICIES[name], status: classify(version, POLICIES[name]) }));
}
