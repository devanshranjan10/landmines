# Launch kit (drafts only: nothing here has been posted)

Every number below was measured: the benchmark in `docs/BENCHMARK.md`, the scans and their audit in
`docs/showcase/`. Don't round up, and keep the caveat lines: the honesty is part of the pitch.

## Assets (all live)

| Asset | Where | Use |
|---|---|---|
| 50 s demo video (1920×1080, MP4) | https://landmine.tech/media/landmine-demo.mp4 | X/LinkedIn native upload, HN comment, newsletters |
| Hook GIF (the real Claude Code session) | `docs/media/landmine-hook.gif` (top of the README) | Reddit, GitHub, Discord |
| Video poster frame | https://landmine.tech/media/landmine-demo-poster.png | thumbnails |
| Benchmark page | https://landmine.tech/benchmark/ | the "does it help" link |
| Scans page | https://landmine.tech/scans/ | the "is this real" link, second wave |
| Logo 400×400 | `docs/launch/assets/logo-400.png` | directory forms |
| Transcripts | https://github.com/devanshranjan10/landmines/tree/main/docs/e2e | proof in comments |

Re-render the video: `CHROME=… PLAYWRIGHT_CORE=… node scripts/video/render.mjs out/` (see the file header).

## The pitch

- **Hook.** "Your coding agent doesn't know about the bug in your exact version."
- **One number.** Claude Sonnet 5.5 went from **86% to 99%** on 21 held-out traps built from bugs filed after its
  training cutoff (72/84 → 83/84). Confirmation run written down before it ran: 6 wins, 0 losses.
- **The twist people repeat.** With web search on, or the Context7 MCP, the agent passed 36/42 and 35/42. Across 84
  sessions it **never once** used them. It didn't think to look.
- **The "in the wild" number.** Across 28 popular open-source projects, the median lockfile pins **395** open GitHub
  issues filed against its exact versions. The 10 coding agents among them (Cline, Continue, OpenCode, Kilo Code,
  Gemini CLI, Qwen Code, OpenHands, Aider, Codex, Goose) have a median of **430.5**. Always pair it with the audit:
  **30 of 40** random ones were confirmed on the exact version (95% CI 60–86%).
- **One command.** `npx landmines scan && npx landmines install --rules`
- **Post your own.** `npx landmines share` prints one line and a README badge (fixed in 0.2.1 to count like `scan`).

## Before launch (needs you)

1. **Publish 0.2.1** (npm's login token on this machine has expired):
   `npm login`, then `sh scripts/release.sh`. That publishes to npm, pushes the tag (whose workflow lists the server
   in the official MCP Registry), creates the GitHub release, dispatches GitHub Packages and bumps the Homebrew tap.
   Check the registry step: `gh run list -w release -L 1`, then
   `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=landmines"`.
   Alternative without a local token: configure npm trusted publishing for `release.yml` on npmjs.com, then
   `git tag -a v0.2.1 -m "landmines 0.2.1" && git push origin v0.2.1`.
2. After it's live, bump the plugin pins (`plugins/landmines/.mcp.json`, `hooks/hooks.json`, `commands/scan.md`,
   `plugin.json`) and the site's `softwareVersion` to 0.2.1, and add "listed in the official MCP Registry" to the
   README only once the curl above returns it.
3. Submit the directories below (they need your logins).

## Directory submissions (prefilled)

Use the same text everywhere:

- **Name**: landmine (package `landmines`)
- **One line**: Known open GitHub issues in your exact pinned dependency versions, for coding agents.
- **Description**: landmine reads your lockfile, finds the open GitHub issues filed against the exact versions you
  pin, and gives your coding agent the bug and the workaround from the thread: a known-bugs section in
  AGENTS.md/CLAUDE.md, a pre-edit hook for 20 agents, and an MCP server (`landmine_check`, `landmine_search`,
  `landmine_list`). On landmine-bench, Claude Sonnet 5.5 went from 86% to 99%. Local, read-only, MIT.
- **Install (MCP, stdio)**: `npx landmines scan` once in the project, then `npx -y landmines mcp`
- **Repo / site**: https://github.com/devanshranjan10/landmines · https://landmine.tech
- **Categories**: developer tools, code quality, security / dependencies

| Directory | How | Status |
|---|---|---|
| Official MCP Registry | automatic from the `v0.2.1` tag (`server.json`) | waits on npm 0.2.1 |
| PulseMCP | ingests the official registry | automatic |
| Glama | glama.ai/mcp/servers → Add Server (repo has `glama.json`) | needs your login |
| awesome-mcp-servers (punkpeye) | PR adding one line under Developer Tools, with the Glama badge; their rule for agent-made PRs is to end the title with 🤖🤖🤖 | after Glama |
| Smithery | smithery.ai → Publish (stdio, `npx -y landmines mcp`) | needs your login |
| LobeHub MCP | already auto-listed; claim it with `lhm login`, then `lhm plugin claim devanshranjan10-landmines` | needs your login |
| cursor.directory | Submit → MCP (reads the root `.mcp.json`) | needs your login |
| mcp.so, mcpservers.org, MCP Market, mcp.directory | each has a submit form; use the text above | needs your email |
| Cline MCP marketplace | issue form on cline/mcp-marketplace with `logo-400.png` and `llms-install.md`; test it in Cline first | needs a Cline test |
| Claude Code plugin directory | claude.ai/directory/manage (the repo is already a marketplace) | needs your account |
| awesome-claude-code | their web form only, not PRs | eligible about 2026-11-04 |

## Hacker News

**Title options** (Show HN, 80 characters max):
- Show HN: Landmine – your coding agent doesn't know about the bug in your version
- Show HN: Agents never searched for known bugs, so I put them in AGENTS.md
- Show HN: Landmine – known open bugs in your pinned deps, in your agent's AGENTS.md

**Text:**

> Coding agents write code against the API they remember. When the version in your lockfile has an open bug, filed
> upstream with a workaround in the thread, the agent has no idea, and it writes the code that hits it.
>
> landmine reads your lockfile, finds the open GitHub issues filed against those exact versions, checks that each one
> really names the version, picks the workaround from the thread, and writes a short known-bugs section into
> AGENTS.md / CLAUDE.md. There is also a pre-edit hook for 20 agents, an MCP server, and a Claude Code plugin.
>
> I measured it. I built 31 trap tasks from bugs filed after the model's training cutoff (pandas, polars, pyarrow,
> scipy, date-fns, zod…), each a small project with a hidden test, validated so the naive solution fails and the
> workaround passes. On the 21 held-out tasks:
>
> - Claude Sonnet 5.5 unaided: 72/84. With the landmine section: 83/84. A confirmation run written down before it
>   ran: 6–0, p = 0.03.
> - With web search on: 36/42. With the Context7 MCP: 35/42. In 84 sessions the agent never used either.
> - The pre-edit hook, the part I expected to win, did not measurably beat nothing. Telling the agent up front did.
>
> How common is this? I scanned 28 popular repos, including 10 coding agents. The median lockfile pins 395 open issues
> filed against its exact versions. I had 40 random ones checked by hand: 30 really were filed against that version;
> most misses were a sibling package from the same repo. Everything is at landmine.tech/scans.
>
> Caveats, all written up: it's my benchmark (none existed for this); every trap was a bug landmine had already
> indexed, so it measures whether it helps once the bug is known, not recall; precision is about 75%; only Claude Code
> was benchmarked.
>
> `npx landmines scan` shows what's in yours. `npx landmines share` prints a line you can paste.

**First comment (post it yourself right after):** the 50-second video link, the transcript link, and "happy to run
it on your repo if you paste the lockfile URL".

## X / Twitter thread

1. Your coding agent doesn't know about the bug in your exact version.
   I measured how much that costs, and what fixes it. 🧵 *(attach the MP4)*
2. I built 31 traps from bugs filed *after* the model's training cutoff. Each is a small project, a normal-sounding
   request, and a hidden test the naive code fails. Claude Sonnet 5.5 unaided: 86%.
3. With web search on: 86%. With the Context7 docs MCP: 83%. In 84 sessions it never used either one. It didn't
   think to look.
4. With landmine's known-bugs section in CLAUDE.md: 99%. The confirmation run was written down before it ran: 6 wins,
   0 losses. *(attach the chart screenshot from landmine.tech)*
5. How common is this? I scanned 28 popular repos. The median lockfile pins 395 open GitHub issues filed against its
   exact versions. The coding agents themselves (Cline, Codex, Gemini CLI, Aider…): median 430.5.
6. I don't trust tools that count things, so 40 random ones were checked by hand: 30 were really filed against that
   exact version. The misses, the labels and every commit: landmine.tech/scans
7. What landmine does: lockfile → open issues in your exact versions → the workaround from the thread → AGENTS.md /
   CLAUDE.md. Plus a pre-edit hook for 20 agents, an MCP server and a Claude Code plugin.
8. Try it: `npx landmines scan`. Post your number: `npx landmines share`.

## Reddit

Post the GIF natively (Reddit autoplays it) and link the landing page in the text, not the repo.

- **r/ClaudeAI.** Title: "Claude never searched for known bugs in 84 sessions, so I put them in CLAUDE.md (86% → 99%)".
  Lead with the "never searched once" finding; mention the plugin: `claude plugin marketplace add
  devanshranjan10/landmines`.
- **r/ChatGPTCoding, r/cursor, r/LocalLLaMA.** Same story, lead with "works with 20 agents", include the MCP config.
- **r/programming.** The scans angle only, no product pitch in the title: "I scanned 28 popular repos' lockfiles for
  open bugs filed against their exact versions (median 395; 30/40 checked by hand)". Link /scans/.
- **r/javascript, r/node, r/Python.** One concrete checked example each from /scans/ (the vaul drawer bug pinned by
  7 of the 28 projects; the sympy `fft` sign bug), then the tool. Don't name and shame: the bugs are upstream.

## Newsletters (email pitch)

Targets: JavaScript Weekly, Node Weekly, Python Weekly, TLDR (Web Dev and AI), Console.dev, Changelog News,
Pointer, Latent Space (for the benchmark).

> Subject: Coding agents never searched for known bugs (84/84 sessions); a small open-source fix
>
> Hi <name>, I built landmine, an MIT CLI that finds the open GitHub issues filed against the exact dependency
> versions a project pins and puts them where coding agents read them. On a benchmark of bugs filed after the model's
> cutoff, Claude Sonnet 5.5 went from 86% to 99%; with web search or Context7 available it never used them. I also
> scanned 28 popular repos: the median pins 395 such issues, and 30 of 40 random ones checked out by hand.
> Page: https://landmine.tech · Scans: https://landmine.tech/scans/ · 50-second video:
> https://landmine.tech/media/landmine-demo.mp4. Thanks for reading, <you>

## Messaging a maintainer (only when they'd want it)

Never send unsolicited PRs or issues about a project's dependencies. If a maintainer asks, or a project's
discussion invites it:

> Ran landmine on <repo>@<sha>: <N> open issues filed against your exact pinned versions, <M> in runtime deps. The
> one that looks most relevant to you is <issue url> (<one-line summary>); the thread has a workaround. Full list:
> `npx landmines scan` in the repo. No action needed, just in case it's useful.

## Timing

- One 48-hour window, Tuesday or Wednesday, about 8am US Pacific: Show HN, the X thread and r/ClaudeAI the same
  morning, all linking landmine.tech.
- Day 2: r/programming with the scans angle; newsletters.
- About a week later: the benchmark as its own post for the evals crowd ("to our knowledge the first public benchmark
  for avoiding known bugs in pinned versions"), inviting other agents' results.
- If HN doesn't catch, post again later with a different angle ("my clever hook lost to a markdown file").

## Claims to never make

- "SOTA on <public benchmark>": say "best measured on landmine-bench", and "to our knowledge the first".
- "Prevents bugs": it informs the agent, when the issue is indexed and names your exact version.
- "Benchmarked on Codex / Cursor / …": only Claude Code was benchmarked.
- "395 bugs in your project": they are open issues in dependency versions you pin, about 75% confirmed on the exact
  version, and your code may never touch them. Always say "open issues filed against the versions you pin".
- "Listed in the MCP Registry" before the curl above returns it.
