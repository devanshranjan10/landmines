# Changelog

## 0.2.2 (2026-10-23)

### Added
- **Hosted MCP server at https://landmine.tech/mcp.** Streamable HTTP, no install or sign-in. `landmine_lookup`
  returns the open issues filed against exact npm or PyPI versions (`next@16.4.0`, `pandas==2.3.1`), optionally
  filtered by an error message; `landmine_check` checks a code snippet against the versions it runs on. Results are
  cached for a day; 60 requests a minute per IP. `claude mcp add --transport http landmine https://landmine.tech/mcp`.
- **`landmine lookup <packages…>`** and a `landmine_lookup` tool in the local MCP server: any exact version, scanned
  or not, through the same registry → GitHub → verify pipeline as `scan`. A bare name means the latest version.
- The MCP servers now introduce themselves with instructions (when to call which tool), a title, an icon and
  https://landmine.tech.

### Changed
- **MCP Registry name: `tech.landmine/landmine`**, verified through landmine.tech, listing both the npm package
  (stdio) and the hosted server. The 0.2.1 name `io.github.devanshranjan10/landmines` is deprecated.
- Without an index, the local MCP server's tools say how to create one and point at `landmine_lookup`.

## 0.2.1 (2026-10-23)

### Added
- **Claude Code plugin.** This repo is now a plugin marketplace:
  `claude plugin marketplace add devanshranjan10/landmines`, then
  `claude plugin install landmines@landmines`. The plugin brings the pre-edit hook, the
  MCP server and a `/landmines:scan` command. Verified in a live session:
  `docs/e2e/claude-plugin-session.jsonl`.
- **Official MCP Registry metadata.** `server.json` and `mcpName`
  (`io.github.devanshranjan10/landmines`). Tagged releases now list themselves in the
  registry from CI.
- `.mcp.json` at the repo root and `glama.json`, for MCP directories that read them.
- **Scans of popular lockfiles** (`docs/showcase`, https://landmine.tech/scans/): 28 open-source projects, 10 of
  them coding agents, with a random audit (30 of 40 issues confirmed on the exact version) and checked examples.
  Reproduce with `scripts/showcase/`.

### Changed
- The `landmine share` badge links to https://landmine.tech instead of the npm page.

### Fixed
- `landmine share` counted an issue once per package that pins it, so one Storybook issue shared by five addons
  counted six times, and it included weak mentions. It now prints the same counts as `scan`: each issue once,
  weak mentions and non-bugs left out. On mastodon's lockfile that is 250 issues, not 385.
- Windows: `check --staged` shows paths relative to the working directory when Windows
  mixes 8.3 short and long path names.

## 0.2.0 (2026-10-21)

**Headline.** A known-bugs section in the agent's instructions measurably helps.
Claude Sonnet 5.5 went from 86% to 99% on landmine-bench's held-out tasks; see
`docs/BENCHMARK.md`.

### Added
- **`landmine rules`.** Writes a marker-delimited "known open bugs" section into
  AGENTS.md / CLAUDE.md / GEMINI.md.
  - `install --rules` writes AGENTS.md and CLAUDE.md by default.
  - Issues are ranked by the APIs your code uses (`--rank usage|confidence`).
  - `--skill` writes the full list as an Agent Skill in
    `.agents/skills/landmine/SKILL.md`.
- **`landmine cards`.** An optional LLM pass, once per issue and cached, that writes a
  trigger card: the APIs, the conditions that make the bug fire, tokens that show the
  workaround is applied, the condition, and the workaround.
  - Providers: Anthropic API, an OpenAI-compatible endpoint, or a Claude Code login.
  - Each card is self-checked against the issue's own repro.
  - The hook, rules and MCP server use cards when present.
- **20 agents.** One payload normaliser, with per-agent output formats.
  - Hooks: Claude Code, Codex, Cursor, Gemini CLI, Copilot, Windsurf/Devin, Droid,
    Auggie, Kiro, Qwen, Crush, Goose, OpenHands, Trae, Antigravity.
  - In-process plugins: OpenCode, Kilo, Cline, Amp, Pi.
  - `install` auto-detects the agents in a project.
- **`install --mcp <agents>`.** Writes MCP config for 16 agents.
- **`landmine check --staged`.** Checks only the lines a commit adds, for pre-commit and
  CI.
- **`landmine share`.** One postable line and a README badge.
- **`scan --offline`.** Re-analyses cached data of any age, with no network.
- **landmine-bench** (`bench/`). A public, agent-agnostic benchmark: 66 validated tasks,
  frozen splits, a leaderboard, Docker and a contamination canary.

### Changed
- `@anthropic-ai/sdk` is now an optional peer dependency, cutting the install from 45 MB
  to 18 MB. Install it only for `cards --provider anthropic`.
- MCP tools declare read-only annotations and search trigger cards.
  - `landmine_check` only reads files inside the project.
  - Search ignores generic words and drops weak matches.

### Fixed (production-readiness review, 2026-10-21)

**Scan and network**
- A package that failed to fetch (network, registry, rate limit, offline without a
  cache) used to lose its known bugs and cards from the index while the scan exited 0.
  It now keeps the previous scan's issues, marked stale, and the scan exits 2.
- GitHub GraphQL rate limits:
  - the client waits until the reset time in the response headers;
  - it gives up when that is too far away;
  - one rate limit stops further GitHub calls for the whole scan.
- `null` nodes in partial GraphQL responses no longer fail a package.
- Requests time out after 30 s. Registry calls retry on 429, 5xx and network errors.
- A lockfile that can't be parsed is named in the error.

**Cards and model providers**
- A corrupt card cache file is treated as a cache miss, and card writes are atomic.
- `cards` caps new model calls at 50 per run (`--max`, `--all`) and prints the plan
  first.
- The `claude` CLI provider:
  - force-kills a hung process;
  - checks once, up front, that `claude` is installed;
  - starts through a shell on Windows.
- `ANTHROPIC_API_KEY` without the optional SDK falls back to the Claude Code login.

**Agent-facing text**
- Everything taken from an issue reaches the agent inside one delimited untrusted
  block: title, evidence, labels, card summary, workaround and maintainer notes. Forged
  delimiters are neutralized.

**Install and uninstall**
- `install` writes portable commands: `npx --no-install landmines` for a dev
  dependency, the pinned npx form for npx/dlx/bunx, `landmine` for a global install.
  It warns when it has to write absolute paths.
- `install`, `uninstall` and `rules` refuse to treat the home directory as a project
  (pass `--root` to override).
- `install --harness auto` skips agents whose config it can't safely edit, instead of
  aborting.
- `uninstall` skips config it never touched, continues past a failure, and deletes
  config files and directories it leaves empty.
- `.landmine/installed.json` is git-ignored.

**Plugins**
- OpenCode and Kilo plugins use one default export: V1 `server` plus V2 `setup`.
  OpenCode 1.18.33 loads this shape.
- The OpenCode/Kilo hook runs landmine asynchronously instead of blocking the host's
  event loop.
- The Cline plugin takes the workspace from the host context.
- Warn mode and heads-ups no longer claim an issue as shown on plugin hosts, which
  can't display a warning.

**CLI**
- `check --exit-code` fails only on matches that would block. `--strict` adds
  heads-ups.
- Errors exit 2.
- `check --staged` reports git's actual error.
- Node older than 22.12 gets a clear message instead of a syntax error.
- On native Windows, MCP configs use `cmd /c` and Cline gets only the plugin.

**MCP**
- `landmine_search` ignores generic words and drops weak matches.

**Licensing**
- `THIRD_PARTY_NOTICES.md` includes the full Apache-2.0 text.

## 0.1.0

First version. It included:
- `scan` (lockfiles → registries → GitHub issues naming the exact version, verified,
  with symbols and workarounds);
- the pre-edit hook for Claude Code, Codex, Cursor and Gemini CLI;
- the MCP server;
- `check` and `list`.
