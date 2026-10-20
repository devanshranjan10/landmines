import { isBuiltin } from 'node:module';

/**
 * Map an import specifier to the npm package that provides it.
 * `drizzle-orm/node-postgres` → `drizzle-orm`, `@tanstack/react-query/build` → `@tanstack/react-query`.
 * Relative paths, builtins, URLs, subpath imports (`#x`) and path aliases (`@/x`, `~/x`) → undefined.
 */
export function packageFromSpecifier(spec: string): string | undefined {
  const s = spec.split('?')[0]?.trim() ?? '';
  if (!s || /^[./#~]/.test(s) || s.includes('://') || /^[a-z]+:/i.test(s)) return undefined;
  if (s.startsWith('@/')) return undefined;
  const parts = s.split('/');
  const name = s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!name || (s.startsWith('@') && parts.length < 2)) return undefined;
  if (!s.startsWith('@') && isBuiltin(name)) return undefined;
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) return undefined;
  return name;
}
