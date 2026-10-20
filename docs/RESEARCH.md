# Research (2026-10-21)

Four parallel research passes ran before any code: prior art, GitHub and registry
APIs, agent hook formats, and lockfile/import parsing. Facts below were checked
against official docs and, where marked, by live requests or installed binaries.
Anything not verified is marked **unverified**.

## 1. Prior art

No existing tool combines all four of landmine's parts: version-exact matching, symbol
matching, workaround extraction, and a pre-edit agent hook.

| Tool | What it does | Version match | Symbol match | Workaround | Agent hook |
|---|---|---|---|---|---|
| [shoulders](https://github.com/mjswensen/shoulders) (62★, 2019, dormant) | lists open issues of every dep in node_modules | no | no | no | no |
| [errorscape](https://www.npmjs.com/package/errorscape) (2024, abandoned) | issue links per dep + stack trace search | no | no | no | no |
| [github-mcp-server](https://github.com/github/github-mcp-server) (33.8k★) | `search_issues`, `list_issues`, `issue_read` on demand | no | no | manual | no (pull only) |
| [helpstack](https://pypi.org/project/helpstack/) (2021) | on Jupyter exception, searches installed libs' issues | no | error text | no | no |
| [Evergreen](https://github.com/arminazimi/evergreen) (0★, 2026-10-13) | lockfile → usage sites → deprecation/EOL rules; CLI + MCP; hook proposed | yes | usage sites | no | planned |
| [npm-issues](https://github.com/seanzarrin/npm-issues) (48★, 2016) | search installed modules' issues by text | no | no | no | no |
| [Kindly Web Search MCP](https://github.com/Shelpuk-AI-Technology-Consulting/kindly-web-search-mcp-server) (400★) | returns full GitHub issue threads when agent searches an error | no | no | raw | no |
| [canidelete](https://github.com/Telle-dev/canidelete) (1★) | inverse: finds your workaround comments whose upstream issue closed | yes | no | n/a | no |
| [Agent.md](https://github.com/Aaditya1273/Agent.md) (10★) | version notes for the majors you use | major only | no | no | no |

Positioning, corrected. The original pitch said "the GitHub MCP covers vulnerabilities
only". **That is false.** Its default `issues` toolset can search and read any public
issue and its comments. Its *dependency-aware* features (the `dependabot` and
`security_advisories` toolsets, and `check_dependency_vulnerabilities`) are
vulnerability-only. Context7 indexes docs and source, not issues
([docs](https://context7.com/docs/adding-libraries)). Wording used in the README:

> Context7 serves docs, not bug reports. GitHub's MCP server can search issues when
> your agent thinks to ask, and its dependency checks cover vulnerabilities only.
> Neither reads your lockfile, matches open bugs to your pinned versions and the
> symbols you're editing, or steps in before the edit.

Risk. Every "list issues for my deps" tool since 2016 stalled because a raw issue list
is noise. Precision of version and symbol matching is the product. Evergreen is the
likeliest fast follower.

## 2. GitHub API (verified live, authenticated)

- **Search scope.** `GET /search/issues` searches title, body **and comments** by
  default. For zod `is:issue "3.22.4"`: 56 total, 32 `in:title,body`, 28
  `in:comments`; 24 of 56 matched only in a comment. The tool has to locate the
  match itself.
- **Version tokens.** A dotted version is one token. `"3.22"` never matches `3.22.4`;
  `"4.0.1"` never matched `14.0.1`. `@` and `^` split tokens, so `zod@3.22.2` and
  `^3.22.2` match. **`v3.22.2` is a separate token**, so the query is
  `("X" OR "vX")`.
- **`advanced_search`** is still opt-in; default is legacy, which honours the OR
  group. Every response now includes `"search_type":"lexical"`. Semantic search
  (GA 2026-04-02) falls back to lexical for quoted text.
- **`is:issue`** is not required for PATs but is required for GitHub App user
  tokens; always include it.
- **Renamed repos.** `repo:tiangolo/fastapi` returns **422**. `GET /repos/{o}/{r}`
  follows the 301 and returns canonical `full_name`. Registries keep stale names, so
  canonicalize before searching.
- **Rate limits.** Search is 30/min with a token and 10/min without, shared per user
  across all tools. Exhaustion is **403** (not 429). Core is 5000/hr with a token
  and 60/hr without (this machine's IP was already 0/60), so a token is required.
  Secondary limits can return 403 or 429; honour `retry-after`, else
  `x-ratelimit-reset`, else back off at least 60 s.
- **GraphQL** search with comments works in one call at cost 1. Query
  `search(type: ISSUE, query: $q, first: N) { ... on Issue { comments(first: K) ... } }`.
  It needs auth. Reactions come back as `reactionGroups { content reactors { totalCount } }`.
  `comments(first:)` gives the oldest comments and `last:` the newest; there is no
  ordering by reactions.
- **Comments REST.** Ordered by ascending id, no sort parameter, `per_page` max 100.
- **Search results are not stable, and some hits don't contain the query string.**
  Observed directly on 2026-10-21. Within about 10 minutes, the same query
  `repo:colinhacks/zod is:issue is:open ("3.23.8" OR "v3.23.8")` returned 5 issues,
  then 0. Two of those five (#6574 and #6014) contain `3.23.8` nowhere in their
  title, body or comments; both are still open. For next.js 14.2.3 the count went
  from 89 to 36. Design consequence: never trust a search hit. Confirm that the
  version string appears in the fetched title, body or comments, and drop the hit
  if it doesn't.
- **Probe of the premise** (open issues mentioning an exact version, 2026-10-21; counts
  vary run to run, see above):

  | Package and version | Open issues |
  |---|---|
  | pydantic 2.9.2 | 189 |
  | next.js 14.2.3 | 36–89 |
  | drizzle-orm 0.36.0 | 60 |
  | typeorm 0.3.20 | 44 |
  | vite 5.4.10 | 38 |
  | date-fns 3.6.0 | 38 |
  | requests 2.32.3 | 22 |
  | sqlalchemy 2.0.36 | 11 |
  | axios 1.7.2, prisma 5.22.0, react-hook-form 7.53.0, fastapi 0.115.0, mongoose 8.8.0 | 0 |

  Issue templates such as drizzle's `### What version of drizzle-orm are you using?`
  put the version on its own line. That is strong evidence the issue was filed
  against that version.
- **Headers.** `User-Agent` is mandatory (403 without it). Pin
  `X-GitHub-Api-Version: 2026-03-10`; the supported versions are `2026-03-10` and
  `2022-11-28`.

Docs: [search](https://docs.github.com/en/rest/search/search?apiVersion=2026-03-10),
[rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
[GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api),
[API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions).

## 3. Registries (verified live)

- **npm.** Use `GET registry.npmjs.org/<name>/<version>` (about 1.5 KB). The
  abbreviated packument has **no `repository`**. `repository` can be an object
  `{type,url,directory}`, `git+https`, `git+ssh`, scp-style `git@github.com:o/r.git`,
  `git://`, a raw string, null, or broken. `directory` signals a monorepo package.
  `bugs` can be a string, an object, or null. Scoped names work encoded or not.
- **PyPI.** Use `GET pypi.org/pypi/<name>/<version>/json` and read `info.project_urls`.
  Normalize labels per PEP 753:
  - source aliases: `source`, `repository`, `sourcecode`, `github`
  - issue aliases: `issues`, `bugs`, `tracker`, ...

  Then fall back to `home_page` only if it is a GitHub URL. Traps: pydantic's
  `Funding` points to `github.com/sponsors/...`, and fastapi still lists the
  pre-rename `tiangolo/fastapi`. Some projects have no GitHub repo (beautifulsoup4).
  PyPI has no edge rate limit but asks for a unique User-Agent.
- **deps.dev v3** works for both registries but repeats the same stale data, so it is
  not used.

Docs: [npm metadata](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md),
[PyPI JSON](https://docs.pypi.org/api/json/),
[PEP 753](https://packaging.python.org/en/latest/specifications/well-known-project-urls/).

## 4. Agent hooks

"Block once, then allow the retry" is possible on all four harnesses. All of them
fail open on hook crash or timeout by default. No harness keeps state between hook
calls, so landmine keeps its own, keyed by session id.

**Claude Code 2.1.304** (verified against docs and the binary)
- Config: `PreToolUse` with matcher `Edit|Write|MultiEdit` in `.claude/settings.json`.
- stdin fields: `session_id`, `cwd`, `tool_name`, `tool_input`.
  - Edit: `{file_path, old_string, new_string, replace_all}`
  - Write: `{file_path, content}`
  - `file_path` is absolute.
- Output: `hookSpecificOutput.permissionDecision: "deny"` with
  `permissionDecisionReason`. The reason is shown to the model.
- `additionalContext` is supported on PreToolUse (since 2.1.9) and capped at 10,000
  characters.
- A hook `deny` is honoured even under `--dangerously-skip-permissions`.
- Timeout fails open. `$CLAUDE_PROJECT_DIR` is set. `MultiEdit` is legacy.

**Codex CLI 0.159.0** (`codex features list` shows `hooks stable true`)
- Config: `.codex/hooks.json` in a project, or `~/.codex/hooks.json`. Same JSON shape
  as Claude.
- The edit tool is `apply_patch`. Its `tool_input.command` is a patch
  (`*** Begin Patch` / `*** Update File:` / `+` lines) and can touch several files.
- Output: same `hookSpecificOutput` shape. `deny` and `additionalContext` are
  supported. Emitting `ask` or `continue:false` marks the hook failed.
- **A hook does not run until the user trusts it in `/hooks`.** The only bypass is
  `--dangerously-bypass-hook-trust`.

**Cursor** (`cursor-agent`; docs plus binary)
- Config: `.cursor/hooks.json` with `{"version":1,"hooks":{"preToolUse":[{"command":..,"matcher":"Write"}]}}`.
- Payload: `tool_input.content` is the **whole file after the edit**, so landmine
  diffs it against disk.
- Output: `{"permission":"deny","user_message":..,"agent_message":..}`. Set both
  messages, because `cursor-agent` feeds `user_message` back.
- Cursor imports Claude Code hooks from `.claude/settings*.json` by default, so
  installing both double-fires. Payloads from Cursor carry `cursor_version`.

**Gemini CLI** (docs only; not installed, **unverified**)
- Config: `BeforeTool` with matcher `write_file|replace` in `.gemini/settings.json`.
  Timeout is in milliseconds.
- Output: `{"decision":"deny","reason":..}`, sent to the model as a tool error.
- No pre-edit `additionalContext`, so "warn" mode is a no-op before the edit.

**MCP.** `@modelcontextprotocol/server` 2.3.1 is the v2 stable line and needs zod
^4.2. `@modelcontextprotocol/sdk` 1.32.1 is v1 and still maintained.

Docs: [Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Cursor hooks](https://cursor.com/docs/hooks),
[Cursor third-party hooks](https://cursor.com/docs/reference/third-party-hooks),
[Gemini hooks](https://geminicli.com/docs/hooks/reference/).

## 5. Lockfiles (verified on generated and real files)

- **package-lock v2/v3.** Direct ranges are in `packages[""].dependencies` and the
  related keys. The version is at `packages["node_modules/<n>"].version`. Aliases put
  the real name in `name`. **v1** has no root entry; read `package.json` and
  top-level `dependencies[n].version`.
- **pnpm.** v9 uses `importers['.'].dependencies.<n>.{specifier,version}`. v6 has
  the same shape at the top level for single projects. v5.4 has
  `dependencies: {n: "1.2.3"}`. Strip the peer suffix at the first `(`. An alias
  version looks like `chalk@4.1.2`. **The file can contain multiple YAML documents;
  use the last one.**
- **yarn v1** (`# yarn lockfile v1`). Keys are comma-joined descriptors, followed by
  `version "x"`. **Berry** has `__metadata` and YAML, with descriptors
  `name@npm:range`. Both need `package.json` ranges to find direct dependencies.
- **bun.lock** (JSONC with trailing commas). Direct ranges are in
  `workspaces[""].dependencies`. Each `packages[n][0]` is `"name@version"`; split at
  the last `@`. `bun.lockb` (binary) is not supported.
- **requirements.txt.** Only `==`/`===` with no wildcard count as pinned. Handle
  extras with commas, markers, `--hash`, `-r` includes, and `\` continuations.
- **poetry.lock / uv.lock** (TOML, `[[package]] name, version`). poetry's direct deps
  come from `pyproject.toml`. uv's root is the package whose `source` is `virtual`
  or `editable = "."`. **Pipfile.lock** maps `default` and `develop`, which include
  transitive deps; direct deps come from `Pipfile`.
- **Parsers.** `smol-toml` 1.9.1 (BSD-3) for TOML. `js-yaml` was 15x faster than
  `yaml` on next.js's 1.3 MB lockfile.

## 6. Imports

- No off-the-shelf parser is both tolerant of mid-edit code and free to install with
  npx.
  - oxc-parser stops at the first fatal error and ships native binaries.
  - es-module-lexer throws on any error.
  - @babel/parser threw even with `errorRecovery`.
  - typescript@7 has no JS API.
  - acorn-loose recovers but is not TypeScript-aware.
- Python `ast` fails on any syntax error.
- **Specifier to package:** strip the query; skip relative paths, `#`, `node:` and
  builtins. Scoped names keep two segments, others keep one.
- **Python dist → import name:** `*.dist-info/RECORD` and `top_level.txt` exist only
  when a venv is present. The pipreqs mapping (Apache-2.0) covers about 1150 common
  mismatches. Fallback heuristic: normalize `-` to `_` and drop a `python-` prefix.
