import { Document, Scalar, parse, visit } from 'yaml';

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
  const doc = new Document(library);
  // Multi-line strings whose first line starts with whitespace are written double-quoted;
  // everything else keeps the default block-scalar style.
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && node.value.includes('\n') && /^[ \t]/.test(node.value)) {
        node.type = Scalar.QUOTE_DOUBLE;
      }
    },
  });
  return doc.toString({ indent: 4 });
}
