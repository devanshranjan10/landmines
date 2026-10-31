# Product Hunt copy

Numbers rule: only 72/84 → 83/84 (86% → 99%) on 21 held-out traps with Claude Sonnet 5.5; web search 36/42 and
Context7 35/42, never used in 84 sessions; median 395 open issues per lockfile across 28 repos; 30/40 hand-checked.
Keep the caveats. No users, stars, downloads or testimonials.

## Name

landmine

## Tagline (pick one, 60 characters max)

1. `Known open bugs in your exact versions, told to your agent` (58)
2. `Your coding agent doesn't know the bug in your exact version` (60)
3. `Open GitHub issues for the versions you pin, for AI agents` (58)

Recommended: 2. It is the hook from the video and the gallery.

## Description (260 characters max)

> landmine reads your lockfile, finds the open GitHub issues filed against the exact npm and PyPI versions you pin, and gives your coding agent the bug and the workaround from the thread: via AGENTS.md/CLAUDE.md, a pre-edit hook and MCP. Free, MIT.

(246 characters)

## Links

- Website: https://landmine.tech
- GitHub: https://github.com/devanshranjan10/landmines
- npm: https://www.npmjs.com/package/landmines
- Hosted MCP: https://landmine.tech/mcp (MCP Registry: `tech.landmine/landmine`)
- Video: https://youtu.be/CncibEdYCDc (uploaded, public)

## Topics

Developer Tools · Artificial Intelligence · Open Source · GitHub

(If PH offers them: "AI Coding Agents" or "Software Engineering" instead of GitHub.)

## Pricing

Free (open source, MIT).

## Maker's first comment

> Hey PH, I'm the maker of landmine.
>
> This started because my coding agent kept writing code that was right for the docs and wrong for the version I actually had installed. The bug was already filed on GitHub, against that exact version, usually with a workaround sitting in the comments. The agent just never looked.
>
> So landmine reads your lockfile, finds the open GitHub issues filed against the exact npm and PyPI versions you pin, and puts them where the agent will see them: a short known-bugs section in AGENTS.md / CLAUDE.md, a pre-edit hook (works with 20 agents) that pauses a risky edit once and hands over the workaround, and an MCP server you can run locally or use hosted at landmine.tech/mcp.
>
> I wanted to know if it actually helps, so I built a benchmark out of bugs filed after the model's training cutoff. On 21 held-out traps Claude Sonnet 5.5 went from 72/84 to 83/84 (86% → 99%) with the landmine section in CLAUDE.md. The part that surprised me: with web search on (36/42) or the Context7 MCP (35/42), it never once used them across 84 sessions. It didn't think to look.
>
> Honest caveats: it's my own benchmark because I couldn't find one for this. Every trap was a bug landmine had already indexed, so it measures whether it helps once a bug is known, not recall. Only Claude Code was benchmarked. And precision is about 75%: I had 40 random issues checked by hand and 30 were really filed against that version.
>
> I also scanned 28 popular open-source repos. The median lockfile pins 395 open issues filed against its exact versions. Those are upstream bugs in libraries, not bugs in those projects, and most code never touches the affected API, but it surprised me how many there are.
>
> Try `npx landmines scan` in a repo. It's local and read-only. I'd really like to hear what it finds, especially the false positives.

## Short answers to likely questions

**Does it send my code anywhere?**
No. The CLI runs locally and never changes your code. `scan` sends only your direct dependency names and versions to
npm, PyPI and the GitHub API, and the hook never touches the network. The hosted MCP (no sign-in) receives the package
versions you look up and any snippet you pass to `landmine_check`; it does not store snippets.

**How is this different from Dependabot or `npm audit`?**
Those cover security advisories. landmine is about ordinary open bugs (wrong results, broken APIs, crashes) filed as
GitHub issues against the version you pin, plus the workaround from the thread, delivered to the coding agent.

**How is it different from Context7 or just letting the agent search?**
Context7 serves docs, not bug reports. In our benchmark the agent had web search (36/42) or Context7 (35/42) available
and never used either in 84 sessions. landmine puts the known bugs in front of it before it writes the code.

**Which agents does it work with?**
The AGENTS.md / CLAUDE.md section works with anything that reads those files. The pre-edit hook supports 20 agents,
including Claude Code, Codex, Cursor, OpenCode, Kilo Code, Cline, Windsurf, Copilot and Antigravity. Anything that
speaks MCP can use the server.

**Which languages?**
npm (npm, pnpm, Yarn, Bun lockfiles) and PyPI (`uv.lock`, `poetry.lock`, `Pipfile.lock`, pinned `requirements*.txt`).
Direct dependencies only.

**How accurate is it?**
About 75%: of 40 random issues checked by hand, 30 were really filed against that exact version. Most misses were a
sibling package from the same repo. The hook only pauses an edit when it uses a symbol from the issue and the file
matches the issue's specifics, and it pauses once per issue per session.

**Is the 86% → 99% number trustworthy?**
It's our own benchmark (none existed for this), and only Claude Code was tested. Every trap was a bug landmine had
already indexed, so it measures whether the agent avoids a known bug, not whether landmine finds every bug. All
transcripts and the method are in the repo (`docs/BENCHMARK.md`).

**Does it need a GitHub token?**
`scan` does, because GitHub search requires auth. It uses `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`; a token with
no scopes is enough. The hosted MCP needs nothing.

**Will the hook get in my way?**
It pauses an edit at most once per issue per session, with the issue and the workaround, and then lets the retry
through.

**What does it cost?**
Free and MIT. The hosted MCP needs no sign-in.
