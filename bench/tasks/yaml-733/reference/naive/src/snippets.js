import { parse, stringify } from 'yaml';

/**
 * A snippet library looks like
 *   { snippets: { [name]: { prefix: string, description?: string, body: string } } }
 * `body` is the code that gets inserted, usually several lines.
 */

/** Load a library from its YAML file contents. */
export function importSnippets(text) {
  const lib = parse(text) ?? {};
  return { snippets: lib.snippets ?? {} };
}

/** Serialise a library to YAML text for the shared snippets repo. */
export function exportSnippets(library) {
  return stringify(library, { indent: 4 });
}
