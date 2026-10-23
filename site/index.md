---
title: "landmine: known open bugs in your exact dependency versions, for coding agents"
url: https://landmine.tech/
updated: 2026-10-23
---

# landmine

> landmine is an open-source CLI (npm package `landmines`, MIT) that reads a project's lockfile, finds the open GitHub issues filed against the exact dependency versions it pins, and puts them where a coding agent reads them (AGENTS.md / CLAUDE.md, a pre-edit hook, an MCP server), with the workaround from each issue thread. On landmine-bench, Claude Sonnet 5.5 went from 86% to 99% on 21 held-out traps built from bugs filed after its training cutoff.

- Website: https://landmine.tech/
- Source: https://github.com/devanshranjan10/landmines
- npm: https://www.npmjs.com/package/landmines (`npx landmines`)
- Homebrew: `brew install devanshranjan10/tap/landmines`
- Author: Devansh Ranjan
- License: MIT (code); CC BY 4.0 (benchmark task data)
- Current version: 0.2.1 (2026-10-23)

## The problem

Coding agents write code against the API they remember, not against the version a project actually pins. When that exact version has an open, already-filed upstream bug, the agent walks into it, even though the bug report, often with a workaround, is sitting in the library's GitHub issues. Agents rarely look: in 84 benchmark sessions where web search or the Context7 docs MCP was available, Claude Sonnet 5.5 never used either.

## What landmine does

1. **Scan.** `npx landmines scan` reads lockfiles (npm, pnpm, yarn, bun, uv, poetry, Pipfile, pinned requirements), resolves exact versions, and finds open GitHub issues that name those versions. Each hit is checked for the version, tied to the code symbols it is about, and given the most useful workaround from its thread. The result is `.landmine/index.json`.
2. **Tell the agent first.** `npx landmines install --rules` writes a short, marker-delimited "known open bugs" section into AGENTS.md and CLAUDE.md, ranked by the APIs the project's code actually calls. This is the part that measured as working.
3. **Backstop.** A pre-edit hook pauses an edit once when it uses an API from a matching issue; an MCP server answers "is this error a known bug in the version we pin?"; `landmine check --staged` checks a commit. All offline after the scan.
4. **Any version, no install.** The hosted MCP server at `https://landmine.tech/mcp` looks up the open issues filed against any exact npm or PyPI version (`landmine_lookup`) and checks a snippet against them (`landmine_check`). Claude Code: `claude mcp add --transport http landmine https://landmine.tech/mcp`. Locally: `npx landmines lookup next@16.4.0`.

## Example

In a real headless Claude Code 2.1.304 session on a project pinning drizzle-orm 0.36.0, the agent was asked to add a `closeDb()` function. Its first edit used `await db.$client.end()`. landmine paused the edit with drizzle-team/drizzle-orm#3402 ("node-postgres client doesn't have end function") and the workaround quoted from the thread. The agent created its own `pg.Pool`, closed it with `pool.end()`, and told the user which issue it had worked around. Transcripts: https://github.com/devanshranjan10/landmines/tree/main/docs/e2e

## Results (landmine-bench v0)

| Setup (Claude Sonnet 5.5, 21 held-out tasks) | Passed |
|---|---|
| No help | 72/84 (86%) |
| landmine rules section in CLAUDE.md | 83/84 (99%) |
| Web search on (same batch, seeds 1–2) | 36/42 |
| Context7 docs MCP (same batch) | 35/42 |
| landmine rules section (same batch) | 42/42 |

- Pre-registered confirmation run on unseen seeds: rules beat no help 6–0 (exact McNemar p = 0.031).
- The pre-edit hook on its own was not significantly better than no help.
- Full results: https://landmine.tech/benchmark.md

## In the wild

Scanned on 2026-10-23: across 28 popular open-source projects (10 of them coding agents: Cline, Continue, OpenCode, Kilo Code, Gemini CLI, Qwen Code, OpenHands, Aider, Codex, Goose), the median lockfile pins 395 open GitHub issues filed against its exact versions (range 192–839). In a random audit of 40, 30 were confirmed on the exact version (95% CI 60–86%). Every project, commit and label: https://landmine.tech/scans.md

## Supported agents

Pre-edit hook (15): Claude Code (verified live), Codex CLI (verified live), Cursor, Gemini CLI, GitHub Copilot, Windsurf / Devin, Antigravity, Factory Droid, Augment, Kiro, Qwen Code, Crush, Goose, OpenHands, Trae. In-process plugin (5): OpenCode, Kilo Code, Cline, Amp, Pi. Any other agent (Aider, Zed, Roo Code, Continue, Warp, Freebuff…) gets the rules section, an Agent Skill and the MCP server.

## Limits

- landmine-bench was built by the landmine authors; every trap is a bug landmine had already indexed, so it measures whether landmine helps once a bug is indexed, not how many bugs it finds.
- Only open issues that name the exact pinned version are found. Only direct dependencies are checked.
- With fully specified prompts, agents already avoid most traps (19/21 unaided vs 21/21 with landmine).

## Quickstart

```sh
npx landmines scan
npx landmines install --rules
```

Needs Node ≥ 22.12 and a GitHub token (`GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`). `npx landmines uninstall` removes everything it wrote.

## How to cite

landmine: https://github.com/devanshranjan10/landmines (Devansh Ranjan, 2026).

```bibtex
@misc{landminebench2026,
  title  = {landmine-bench: Do Coding Agents Avoid Known Open Bugs in Pinned Dependency Versions?},
  author = {Ranjan, Devansh},
  year   = {2026},
  note   = {Version 0. https://landmine.tech/benchmark/}
}
```
