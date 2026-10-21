# Launch kit (drafts only: nothing here has been posted)

Every number below is from `docs/BENCHMARK.md` and was measured. Don't round up, and
don't drop the caveat lines: the honesty is part of the pitch.

## The pitch

- **Hook.** "Your coding agent doesn't know about the bug in your exact version."
- **One number.** Claude Sonnet 5.5 went from **86% to 99%** on 21 held-out traps built
  from bugs filed after its training cutoff (72/84 → 83/84). A confirmation run written
  down before it ran: 6 wins, 0 losses.
- **The twist people will repeat.** With web search on, or the Context7 MCP, the agent
  passed 36/42 and 35/42. Across 84 sessions it **never once** used them. It didn't
  think to look. landmine puts the bug in front of it.
- **One command.** `npx landmines scan && npx landmines install --rules`
- **Post your own.** `npx landmines share` prints "landmine found N open GitHub issues
  filed against the exact versions this project pins…" plus a README badge.

## Second launch asset: the benchmark

"The first public benchmark for whether coding agents avoid known open bugs in pinned
dependency versions." It has 66 validated tasks, is agent-agnostic, includes a
leaderboard, Docker and a canary, and its results are already in. It gets its own Show HN
or post, aimed at the evals and agents crowd, about a week after the tool launch, with an
invitation to submit agents (Cursor, Aider, OpenHands, Codex users).

Say "to our knowledge, the first" and cite the related work in `bench/README.md`. Never
say "the only" or "SOTA".

## Before launch (needs you)

1. **Create the GitHub repo** (public, MIT). Then:
   - add `repository`, `homepage` and `bugs` to `package.json`;
   - replace `YOUR_GITHUB` in `site/index.html`.
2. **Review what goes public:**
   - `bench/results/*.jsonl`: run metadata, no transcripts;
   - `bench/realcode/*.json`: public file paths and SHAs, plus model labels;
   - `bench/fixtures/cache` and `bench/fixtures/noise-fresh-a.json`: public issue text;
   - `docs/e2e/*.jsonl`: redacted agent transcripts.
3. **Publish to npm** (deliberately not done: it is irreversible and outward-facing).
   `npm login && npm publish`. The dry run passes: `landmines@0.2.0`, 89 kB tarball,
   18 MB install, and the name was still free on 2026-10-21.
4. **Update the README install section to the published form.** Replace the "not
   published to npm yet" paragraph with `npx landmines scan && npx landmines install
   --rules`, and drop the tarball notes.
5. **Record the demo GIF** with `vhs docs/launch/demo.tape`, run in `examples/demo`. Put
   it at the top of the README and on the landing page.
6. **Deploy `site/index.html`** to GitHub Pages or any static host, on its own short
   domain if you can. The REA lesson: the post that took off linked the landing page,
   not the repo.

## Hacker News

**Title options** (Show HN, 80 characters max):
- Show HN: Landmine – your coding agent doesn't know about the bug in your version
- Show HN: Landmine – known open bugs in your pinned deps, in your agent's AGENTS.md
- Show HN: Agents never searched for known bugs, so I put them in AGENTS.md

**Text:**

> Coding agents write code against the API they remember. When the version in your
> lockfile has an open bug, filed upstream with a workaround in the thread, the agent
> has no idea, and it writes the code that hits it.
>
> landmine reads your lockfile, finds the open GitHub issues filed against those exact
> versions, checks that each one really names the version, picks the workaround from
> the thread, and writes a short known-bugs section into AGENTS.md / CLAUDE.md. There
> is also a pre-edit hook for 20 agents and an MCP server.
>
> I measured it, because "it helps" isn't a claim. I built 31 trap tasks from bugs
> filed after the model's training cutoff (pandas, polars, pyarrow, scipy, date-fns,
> zod…). Each is a small project with a hidden test, and each was validated so that the
> naive solution fails and the workaround passes. Results on the 21 held-out tasks:
>
> - Claude Sonnet 5.5 unaided: 72/84. With the landmine section: 83/84. A confirmation
>   run written down before it ran: 6–0, p = 0.03.
> - With web search turned on: 36/42. With the Context7 MCP: 35/42. In 84 sessions the
>   agent never used either. It didn't think to look.
> - The pre-edit hook, the part I expected to win, did not measurably beat nothing.
>   Telling the agent up front did.
>
> Caveats, all in BENCHMARK.md: it's my benchmark (none exists for this); every trap
> was a bug landmine had already indexed, so this measures whether it helps once the
> bug is known, not recall; in a big repo only the 15 issues closest to your code fit
> in the list; only Claude Code was benchmarked.
>
> `npx landmines scan` shows what's in yours. `npx landmines share` prints a line you can
> paste.

## X / Twitter thread

1. Your coding agent doesn't know about the bug in your exact version.
   I measured how much that costs, and what fixes it. 🧵
2. I built 31 traps from bugs filed *after* the model's training cutoff. Each is a small
   project, a normal-sounding request, and a hidden test the naive code fails.
   Claude Sonnet 5.5 unaided: 86%.
3. With web search on: 86%. With the Context7 docs MCP: 83%. In 84 sessions it never
   used either one. It didn't think to look.
4. With landmine's known-bugs section in CLAUDE.md: 99%. The confirmation run was
   written down before it ran: 6 wins, 0 losses.
5. What landmine does: lockfile → the open GitHub issues filed against your exact
   versions → the workaround from the thread → AGENTS.md / CLAUDE.md. Plus a pre-edit
   hook for 20 agents (Claude Code, Codex, Cursor, OpenCode, Kilo, Cline, Windsurf…).
6. The surprise: the pre-edit hook, the clever part, didn't measurably help. Telling the
   agent *before* it plans did. Full method and every caveat: BENCHMARK.md.
7. Try it on your repo: `npx landmines scan`. Post your number: `npx landmines share`.

(Attach the demo GIF to post 1 and the chart from the landing page to post 4.)

## Reddit

- **r/ClaudeAI, r/ChatGPTCoding, r/LocalLLaMA (tools posts).** Same story as the HN
  text, but lead with the "never searched once" finding and the chart. Link the landing
  page.
- **Ecosystem subs, where a scan finds real bugs** (r/Python, r/javascript, r/node).
  Lead with `npx landmines scan` output on a well-known open-source project. Don't name
  and shame; pick one that has a workaround thread.

## The first 48 hours

- Show HN, the X thread and the Reddit posts go out the same morning, US time, linking
  the landing page.
- Seed the second wave: invite people to post their `landmine share` line and badge.
  Retweet the good ones.
- Ready-made follow-up posts:
  - "Here are the N open bugs in the exact versions of <popular stack>" from a real
    scan;
  - per-ecosystem threads (pandas 3.0.x, polars 2.0, pyarrow 25/26).
- If HN doesn't catch, post again with a different angle; REA hit on its fifth try.
  Angles:
  - "agents never search unprompted";
  - "my clever hook lost to a markdown file".

## Claims to never make

- "SOTA on <public benchmark>": no other public benchmark measures this. Say "best
  measured on landmine-bench", and "to our knowledge the first public benchmark for it".
- "Prevents bugs": it informs the agent, and it works when the issue is indexed and
  names your exact version.
- "Benchmarked on Codex / Cursor / …": only Claude Code was benchmarked. The Codex run
  was void because the plan's quota ran out.
