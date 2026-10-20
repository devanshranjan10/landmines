/**
 * Database dialects. ORM issues are usually specific to one database (drizzle labels `db/mysql`,
 * typeorm labels `driver: postgres`), and the same symbol (`serial`, `upsert`) exists for all of them.
 */
const DIALECT_WORDS: Record<string, string[]> = {
  postgres: ['postgres', 'postgresql', 'pg', 'pg-core', 'node-postgres', 'postgres-js', 'neon', 'neon-http', 'neon-serverless', 'vercel-postgres', 'pglite', 'supabase', 'psycopg', 'psycopg2', 'asyncpg', 'cockroachdb', 'aurora-postgres'],
  mysql: ['mysql', 'mysql2', 'mysql-core', 'mariadb', 'planetscale', 'planetscale-serverless', 'tidb', 'tidb-serverless', 'singlestore', 'pymysql', 'mysqlclient', 'aurora-mysql'],
  sqlite: ['sqlite', 'sqlite3', 'sqlite-core', 'better-sqlite3', 'libsql', 'turso', 'd1', 'bun-sqlite', 'expo-sqlite', 'op-sqlite', 'sql.js', 'sqljs', 'sqlite-proxy', 'aiosqlite'],
  mssql: ['mssql', 'sqlserver', 'sql-server', 'tedious', 'pyodbc'],
  oracle: ['oracle', 'oracledb', 'cx_oracle'],
  mongodb: ['mongodb', 'mongo', 'mongoose', 'pymongo', 'motor'],
};

const WORD_TO_DIALECT = new Map<string, string>();
for (const [dialect, words] of Object.entries(DIALECT_WORDS)) for (const w of words) WORD_TO_DIALECT.set(w, dialect);

/** Database/driver names are context, not APIs. */
export function isDialectWord(word: string): boolean {
  return WORD_TO_DIALECT.has(word.toLowerCase());
}

function dialectsInTokens(tokens: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    const d = WORD_TO_DIALECT.get(t.toLowerCase());
    if (d) out.add(d);
  }
  return out;
}

/** Dialects an issue is explicitly about, from its title and labels only (bodies mention too much). */
export function issueDialects(title: string, labels: string[]): string[] {
  const tokens = [...title.split(/[^\w.-]+/), ...labels.flatMap((l) => l.split(/[^\w.-]+/))];
  return [...dialectsInTokens(tokens)].sort();
}

/** Dialects a source file is using: imported module paths and connection URL schemes. */
export function fileDialects(specifiers: string[], fileText: string): Set<string> {
  const tokens = specifiers.flatMap((s) => s.split(/[/.]/).concat(s));
  for (const m of fileText.matchAll(/\b(postgres(?:ql)?|mysql|mariadb|sqlite|mssql|mongodb(?:\+srv)?)(?:\+\w+)?:\/\//gi)) tokens.push((m[1] ?? '').replace(/\+srv$/, ''));
  return dialectsInTokens(tokens);
}
