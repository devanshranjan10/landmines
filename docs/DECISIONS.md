# Decisions

The owner pre-approved every brainstorming and planning gate and was unavailable
while this was built. Every choice that would normally have been a question is
logged here with the reasoning, so it can be reviewed and reversed.

Format: `D-NN — decision` then why, and what would change it.

## Process

**D-01 — Treat this as an architectural (new project) build.**
New repo, no existing flow to change. Full path: research → spec → plan →
milestones. Gates are self-approved per the owner's instruction and recorded here.

## Packaging and toolchain

**D-02 — npm package name `landmines`, binary names `landmine` and `landmines`.**
`landmine` on npm is taken (v0.0.1 "Proximity trigger", last modified 2022-06-19).
`landmines` was free on 2026-10-21. `npx landmines <cmd>` resolves the bin that
matches the package name, so both bins are shipped. Nothing is published (hard rule).

**D-03 — TypeScript pinned to `~6.0.3`, not 7.x.**
`typescript@7.0.2` is current, but `typescript-eslint@8.72.0` declares
`typescript: >=4.8.4 <6.1.0`. Lint is a required gate, so the compiler follows the
linter's supported range.

**D-04 — Node engine `>=22.12`.**
The owner asked for Node 22+. `vitest@5` requires `^22.12.0`, `commander@15`
requires `>=22.12.0`. Development machine runs Node 26.0.0.

## Product and design (spec: `docs/superpowers/specs/2026-10-21-landmine-design.md`)

**D-05 — Architecture: prebuilt index plus an offline hook (approach A).**
Live GitHub calls inside the hook (B) would add network latency to every edit. They
would also spend a search budget of 30/min that the user shares with every other
tool on the token. MCP-only (C) is pull-based, and GitHub's MCP already does pull.
LLM relevance (D) is deferred: it needs a key, has a cost, and isn't deterministic.

**D-06 — Corrected the positioning claim.** The pitch said "the GitHub MCP covers
vulnerabilities only". Research found that false: its default `issues` toolset
searches and reads issues and comments on demand. The README says its
*dependency-aware* checks are vulnerability-only and that nothing reads your lockfile
or interrupts an edit.

**D-07 — Direct dependencies only.** The hook matches symbols your own code imports,
and code only imports direct dependencies. Transitive dependencies cost search budget
without adding hook value. To revisit, add `--transitive` for the report only.

**D-08 — Verify every search hit locally.** On 2026-10-21 GitHub search returned zod
issues that do not contain the queried version anywhere, and counts swung from 89 to
36 between identical queries. A hit is kept only if the version string is found in
the fetched title, body or comments. Dropped hits are counted and shown.

**D-09 — A tolerant, dependency-free lexer for imports and usage, not a parser.**
Mid-edit code is often unparseable:
- oxc-parser stops at the first error and ships native binaries
- es-module-lexer and @babel/parser throw
- TypeScript 7 has no JS API

landmine only needs import bindings and identifier chains, which a lexer that blanks
comments and strings handles. The same analyzer runs on issue code blocks.

**D-10 — Version mentions carry polarity.** "Works in X", "fixed in X" and
"downgrading to X fixes it" mean the user's pinned X is *not* affected. Issues that
only mention the version that way are dropped.

**D-11 — The hook blocks once per (session, issue), then allows.** "Interrupt
mid-edit" means a PreToolUse deny, which the model sees on every harness and which is
honoured even under `--dangerously-skip-permissions`. To avoid wedging the agent, the
retry goes through. The hook never emits "allow", because that would bypass the
user's permission prompts. `--mode warn` uses `additionalContext` instead.

**D-12 — Fail open, always exit 0.** Any internal error produces empty output. The
hook never uses exit code 2 and never sets `onFailure: block`.

**D-13 — Quoted workarounds are framed as untrusted.** landmine injects strangers'
text into a model's context, which is a prompt-injection channel. Quotes are
labelled untrusted, cleaned of HTML and comments, length-capped, and flagged when
they contain shell download-and-execute patterns or non-GitHub links.

**D-14 — One universal `landmine hook` that detects the harness from the payload.**
This is less config to get wrong. `--harness` overrides detection.

**D-15 — Install the Claude-format hook by default.** Cursor imports Claude hooks by
default, so installing both would double-fire. Exclusive-create markers make a double
fire harmless anyway.

**D-16 — A GitHub token is required for `scan`.** It comes from `GITHUB_TOKEN`, then
`GH_TOKEN`, then `gh auth token`. GraphQL needs auth, and the anonymous core limit
(60/hr) was already exhausted on this machine's IP. The hook never needs a token.

**D-17 — GraphQL search fetches issues and comments in one call.** That is cost 1 per
page and doesn't use the REST search bucket. Comments come from the first 40 and
last 20, because GraphQL can't order by reactions. Repos are canonicalized via REST
`GET /repos/{o}/{r}`, because `repo:` on a renamed repo returns 422.

**D-18 — Python import names.** The source of truth is installed `*.dist-info`
RECORD/top_level.txt when a venv is present. Otherwise an embedded copy of the
pipreqs mapping (Apache-2.0, attributed in `THIRD_PARTY_NOTICES.md`). Otherwise the
normalized name.

**D-19 — The spec was self-approved, and the plan was written by hand.** The owner
pre-approved every gate. The `writing-plans` skill is not installed in this
environment: both `writing-plans` and `anthropic-skills:writing-plans` returned
"Unknown skill". The plan at `docs/superpowers/plans/2026-10-21-landmine.md` follows
that skill's usual shape (milestones, files, tests, verification, commit). It runs
inline in this session, one commit per milestone.

**D-20 — Code fences can support a symbol but never trigger the hook alone.** In
drizzle-orm 0.36.0, most repros call the `drizzle()` factory. If a fence counted as
much as prose, every edit that creates a db would fire. Weights:
- issue title: 1.0
- inline code span in the body: 0.7
- member used in a fence: 0.5
- entry point imported or called in a fence: 0.2

The hook threshold is 0.6, so the issue author has to name the symbol in prose.
Measured on the recorded corpus.

**D-21 — Workaround picks need a claim, or are labelled `top-reply`.** On the corpus,
code plus upvotes often meant a diagnosis ("the issue lies in this line"), not a fix.
A pick needs a fix-claiming phrase. "Any workaround?" is a question and doesn't count.
A reply with code and at least 3 reactions but no claim is shown as "top reply",
never as "workaround".

**D-22 — Three drop reasons, all reported.**
- `unverified`: the version isn't in the fetched text.
- `unaffected`: the version is only named as working, fixed, or upgraded-from.
- `incidental`: the version appears only in URLs or hidden comments.

**D-23 — Version answers for another product don't count.** drizzle's template asks
for both the drizzle-orm and the drizzle-kit version, and #3547 answers 0.36.0 under
drizzle-kit. A mention is attributed elsewhere when its label names a different
package (a backticked or kebab-case name) or an OS/runtime (macOS, Node.js,
Python…). Without this, "macOS 14.2.1" would count as evidence for next@14.2.1.

**D-24 — `@types/*` packages are not searched.** DefinitelyTyped versions mirror the
upstream package, so searching for "20.11.0" finds Node.js runtime issues, not
type-definition bugs. These packages are recorded as `skipped`.

**D-25 — Database dialect context.** The first real `check` on the demo found a false
positive. `serial` in a file importing `drizzle-orm/pg-core` matched #3333, a
MariaDB-only bug: same symbol name, different database.
- Landmines now record the dialects named in their title and labels (`db/mysql`,
  `driver: postgres`).
- The edited file's dialects come from its imports and connection URLs.
- A dialect-specific issue only fires when the two overlap.

**D-26 — Cache raw network data, not analysis.** Caching analysed landmines meant
analysis fixes stayed invisible for 24 h. Scan now caches raw registry and GitHub
responses per package version in `.landmine/cache/`, git-ignored via
`.landmine/.gitignore`, and always re-analyses. The index stays small enough to commit.

**D-27 — Block only on corroborated hits; a bare symbol match is a heads-up.** We ran
`check` on 60 real files fetched from public repos that import the held-out packages.
Of 28 hits, 2 were relevant, 1 partly relevant and 25 noise. In the noisy hits the
code did use the buggy API, but not under the condition that triggers the bug.
Examples:
- `jwt.verify` without `audience`, against a ReDoS that needs an `audience` RegExp
- `make_subplots` without `hoversubplots`

A hit now blocks only when the file also contains a second, issue-specific symbol:
an option, plugin, sibling API, or driver import path. The match must add a novel,
non-generic part and cannot be a bare import binding. Uncorroborated hits reach the
model as non-blocking context ("heads-up, not blocking … may well not apply") on
Claude Code and Codex, and stay silent on Cursor and Gemini CLI, which have no
non-blocking pre-edit channel.

This rule was designed after seeing those 60 files, so it is measured on a fresh set
of real files (docs/ACCURACY.md).

**D-28 — Python module paths are namespaces.** The issue's own `import`/`from` lines
show which dotted names are modules (`sklearn.model_selection`, `torch.distributed`).
Those, plus lowercase middle segments of chains rooted at the package, are scored as
generic. Touching a module says nothing about which function is buggy.

**D-29 — Heads-ups are off by default.** On held-out real-code set C3 (60 files from 60
new repos, final rules), 13 files had matches.
- 1 file would block. That block was a near miss: right API and option, wrong calling
  form.
- Of 27 uncorroborated matches, 2 were partly relevant and 25 were not.

Feeding the agent context that is about 93% irrelevant is a cost, not a feature. The
default is now: block once on corroborated matches, otherwise say nothing. Skipped
matches don't use up the issue's one showing. Two ways to see more:
- `--heads-up` adds the weaker matches as non-blocking context.
- `--mode warn` never blocks and passes everything as context.

The scan report and `landmine list/check` still show every match.

**D-30 — The MCP server is on-demand.** It uses SDK v2 (`@modelcontextprotocol/server`
2.3.1) with zod 4, loaded lazily. Since D-29 the hook stays silent on weak matches.
`landmine mcp` covers the case where the agent is already looking for an answer, for
example a confusing error: `landmine_search` finds indexed issues by error text or API
name, `landmine_check` checks a file or snippet, and `landmine_list` lists issues.
The SDK and zod are imported lazily inside the `mcp` command. Without that, tsup
would hoist them into every CLI start, including the hook; hook latency stayed at
0.09 s. Verified live: Claude Code connected through `--mcp-config` (the same JSON
shape `install --mcp` writes to `.mcp.json`), called `landmine_search`, and answered
with pydantic#10544.

**D-31 — Fixes from an independent code review.** Each one has a regression test.
- **Hostile issue text could stall `scan`.** Exponential backtracking in the
  version-list regex: 57 s on one body, now 4 ms. Quadratic `^\s*`, `\s*` and
  per-mention scans: 6–10 s, now under 5 ms.
  - Issue bodies are capped at 20k and comments at 8k characters for analysis.
  - Mentions per text are capped at 200, with bounded windows.
  - Comment removal is scan-based, and the list check is split-based.
- **Hook bookkeeping.**
  - Only the issues actually shown are marked shown. Previously issues 4+ were
    claimed and never surfaced.
  - A heads-up that a harness cannot display no longer uses up the issue.
- **Hook file reads.** The hook reads only regular JS/TS/Python files under 2 MB, so
  FIFOs and devices can't hang it.
- **Hook state.** It lives in a per-user directory (`landmine-<uid>`).
- **Hook stdin.** Capped at 10 MB and 5 s.
- **install/uninstall.**
  - Only landmine's own command shapes are recognised, plus a registry of installed
    commands in `.landmine/installed.json`. Before this, `/home/u/landmine-api/…hook.sh`
    would have been deleted.
  - Settings files with comments are refused rather than rewritten without the
    comments.
  - `--harness all` checks every target before writing any.


## v0.2 (2026-10-21, second session)

**D-32 — Process for v0.2.** The owner asked for evals, benchmarks, "SOTA" and support
for every coding agent. When asked, they chose "Autonomous, up to ~$100". So, as in
v0.1, I approve my own spec and plan, log decisions here, and stop only when it is
built, benchmarked and documented. The spec is
`docs/superpowers/specs/2026-10-21-landmine-v0.2-design.md`, and the plan sits next to
it in `plans/`.

**D-33 — What "SOTA" means in this repo.** No public benchmark measures this task
(eval research, RESEARCH §8). Claiming SOTA on GitChameleon, VersiCode or SWE-bench
would be a category error. So we build landmine-bench v0, freeze a dev/test split
before tuning, run named baselines on it, and every "best" claim is scoped to "best
measured arm on landmine-bench v0". The README headline is the test-split table,
whatever it shows.

**D-34 — Trigger cards over a hook-time LLM judge.** A judge on every matching edit adds
seconds, a network call and non-determinism. A card is written once per issue at scan
time and checked offline in the hook, which keeps it at about 0.1 s. This follows the
QLCoder pattern (eval research §4). Cards are opt-in and need a provider. Without one,
v0.1 behaviour is unchanged.

**D-35 — The static rules file is both a feature and a baseline.** Vercel found a
passive AGENTS.md index beat on-demand skills in their agent evals. A
`KNOWN_ISSUES` section is also the only thing that works in *every* agent. So
`landmine rules` ships, and the bench measures it as its own arm against the hook.
If it wins, the README says so.

**D-36: landmine-bench v0 tasks and frozen split.** There are 35 trap tasks, one per
solid bug from the spike. Each one was validated fail→pass by
`scripts/bench/validate.ts`:
- the untouched seed fails;
- the naive solution fails;
- the workaround passes;
- the trigger regex matches the naive solution only.

The subagents that wrote the tasks noted fairness concerns for each one, kept in
`docs/BENCHMARK.md`. The split is seeded (20261021) and assigns whole packages to one
side, so tuning on dev never sees a test package. Packages go to dev until dev
reaches a third of the tasks. dayjs's 7 tasks crossed that line, which gave 17 dev
and 18 test. I kept that result instead of re-rolling, because re-rolling the split
until it looks right is a quiet form of tuning. Test covers 8 packages:
- npm: axios, date-fns, jsonwebtoken, knex
- PyPI: numpy, pandas, pyyaml, seaborn

**Selection bias, stated up front.** Every trap was picked *from* landmine's own
index, so the bench measures conditional effectiveness: given that the bug is
indexed, does the tool help the agent avoid it? It says nothing about recall.

**D-37: A post-cutoff ("fresh") task set is the headline.** The pilot showed Sonnet
and Haiku solve the 2024 traps unaided: they already know those bugs. So 31 more
tasks were built from issues opened on or after 2026-07-01 against current releases.
They were validated the same way as D-36. One more task (scikit-learn#35032) was
left unfinished and parked in `bench/.work/incomplete`. It was dropped, not repaired
after seeing results. The fresh set has its own frozen split (`bench/split-fresh.json`,
same seed and rule): 10 dev, 21 test. The 2024 set is reported as a contaminated
control.

**D-38: Card prompt v2 was tuned on fresh-dev only.** Two changes came from v1 on
fresh-dev:
- **Footguns count as bugs.** v1 called PapaParse#1174 "not a bug" because the
  behaviour is documented, yet it silently drops data. The bug definition now counts
  documented footguns that lose data or give wrong results.
- **`unless` tokens.** v1 blocked 4 of 10 correct solutions. The new `unless` field
  names tokens that show the workaround is already applied.

Mechanical filters were added at the same time:
- the package name never counts as an API;
- keywords never count as tokens;
- a bare number counts only in argument position;
- an operator counts only inside a string literal.

Nothing was looked at on fresh-test or on the 2024 test split before the cards were
frozen.

**D-39: `check --staged` is the fallback for agents with no pre-edit hook.** It
checks only the lines a commit adds, against the staged blob, so it can run in a
pre-commit hook or in CI. It is a safety net after the fact, not an interruption.
Agents without hooks (Freebuff, Aider, Zed, and others) also get the rules section
and the MCP server.

**D-40: Terse prompts, added after seeing dev baselines.** With the spec prompts,
unaided Sonnet and Haiku passed 9–10 of the 10 fresh-dev tasks. The prompts state the
bug's edge case as a requirement, so a careful agent codes around a bug it has never
heard of.

A separate agent wrote `prompt-terse.txt` for all 31 fresh tasks under one fixed
rule:
- Keep the interface, format and data facts.
- Remove only sentences that prescribe the edge-case behaviour.

The prompts were not tuned to results. Eight came out identical to the spec prompt,
and three are flagged borderline in `bench/tasks/TERSE.md`. date-fns-4384 is the most
at risk, and results are reported with and without the flagged tasks.

This change was made after seeing baselines and it favours the tool, so both prompt
styles are reported.

On fresh-dev with terse prompts, Sonnet in exec mode still passed 10/10 in every arm.
**No dev result favoured any card policy, so the policy was frozen unchanged before
the test split ran:**
- corroborated heuristic hits and card hits with confidence ≥ 0.5 block once per issue;
- `cards-warn` is measured as a separate arm.

**Disclosure.** While choosing the policy I printed the card *shapes* for the
fresh-test targets: whether each has a `requires` group, its confidence, its
self-check result. No outcomes were printed. They were not used, since nothing
changed.

**D-41: Real-code false blocks get their own track.**
- **Setup.** 150 public files that import the bench packages (R1,
  `bench/realcode/manifest.json`). Each whole file is checked against every bench
  version of its package. Each block is labelled by an Opus judge
  (`bench/realcode/labels.json`) that sees the file and the issue's condition, not the
  arm.
- **R1 results:**
  - heuristic hook: 13/192 file × version pairs blocked, 3/16 blocks plausibly
    relevant;
  - cards: 43/192 blocked, 11/56 plausibly relevant;
  - no block was judged to clearly meet the condition, in either arm.
- **Status.** R1 was looked at while choosing policy, so it is a tuning set. A second
  set from different repos (R2) is the held-out number.

**D-42: Pre-registered confirmatory run, written before running it.**
- **What run A showed** (fresh-test; Sonnet, exec, terse prompts, seeds 1–2):
  - rules 41/42, cards 38/42, none 36/42, hook 35/42, cards-warn 35/42;
  - rules vs none: 5 discordant pairs, all for rules (exact McNemar p ≈ 0.06).
- **Why rules helped.** It reaches the agent before it plans. On polars-30043 the hook
  never fired, because the card lists the writer APIs and the agent only edited the
  reader.
- **Two hypotheses, fixed now, before any data:**
  - **H1:** rules > none.
  - **H2:** a combined arm `rules+cards` (rules section plus card hook, the
    configuration `install --rules` gives) ≥ rules.
- **Design.** Seeds 3–4 on the same 21 tasks and the same setup, all six arms. Seeds
  1–2 are not pooled into the confirmatory test.
- `rules+cards` was added after seeing run A, so any claim about it rests on seeds
  3–4 only.

**D-43: The rules section in a realistic project, recorded before running.**
- **The problem.** In the bench, the rules section lists only the task package's
  issues. A real project has many more. eval/fresh-a has 46 dependencies and 173
  issues armed by cards.
- **Offline check** (`scripts/bench/rules-inclusion.ts`). Each task's issues were
  merged with fresh-a's (the task's own package removed from the noise). Ranked by
  card confidence, the target issue makes the top 15 for **2/21** fresh-test tasks
  and the top 60 for 12/21. So the bench's rules result overstates what a 15-item
  section does in a big project.
- **Response: usage ranking.** `landmine rules` now ranks by what the project's code
  uses:
  - an issue whose API appears in a file importing its package ranks first;
  - then issues in imported packages.
- **Two new arms, to bracket the real effect.** Both use the merged index and seeds 1–2
  on fresh-test, paired with run A's `none` and `rules`.
  - **`rules-noisy-conf`** (confidence ranking): the pessimistic bound.
  - **`rules-noisy`** (usage ranking): the optimistic bound. The noise packages are not
    imported by the task project, so the simulation flatters usage ranking.
- **Prediction, recorded before running:** `rules-noisy-conf` loses most of the rules
  advantage.
- The noise index is frozen in `bench/fixtures/noise-fresh-a.json`.

**D-44: The rules section leads; the hook becomes a second line of defence.**

*Evidence* (full tables in BENCHMARK.md):
- **Headline.** On fresh-test, the rules section beat no help 20–3 across the planned
  runs (p = 0.0005), and 6–0 in the pre-registered confirmatory run (p = 0.03).
- **The hook arms.** Neither the heuristic hook nor card matching was significantly
  better than nothing.
- **Big projects.** With a real project's issues mixed in:
  - confidence ranking lost the whole advantage (35/42 against 36/42 unaided);
  - usage ranking kept it (42/42), in a simulation that flatters it.

*Changes:*
- **README.** It now leads with `landmine install --rules`.
- **Rules ranking.** `landmine rules` and `install --rules` rank by project usage by
  default. `--rank confidence` gives the old order.
- **Default files.** `install --rules` now writes CLAUDE.md as well as AGENTS.md. Before
  this, a project with neither file got only AGENTS.md, which Claude Code does not
  read, while the benchmark used CLAUDE.md. That was a gap between what was measured
  and what users would get, and it is closed.

*Kept as is:*
- **Hook defaults.** The hook's block-once policy and card threshold are unchanged. No
  evidence favoured another policy for Sonnet. For Haiku, context-only cards (37/42)
  beat blocking cards (31/42), which is worth revisiting with more data.

**D-45: A second agent, recorded before any Codex data.** The rules result was
measured on Claude Code only.

*Setup:*
- **Agent:** Codex CLI 0.159.0 (`codex exec`), ChatGPT login, model `gpt-5.6-terra`,
  reasoning effort medium.
- **Sandbox:** workspace-write, with commands allowed and no network.
- **Prompts and data:** the same tasks, terse prompts, frozen index and cards.

*Arms and design:*
- **Arms:** `none` and `rules`. For Codex the rules section goes into AGENTS.md, which
  is what Codex reads.
- **No hook arms.** Codex often edits files through shell commands, which no edit hook
  sees.
- **Hypothesis:** rules > none on fresh-test, seeds 1–2.
- **Analysis:** paired, exact McNemar.

The dev pipeline check (one task) is not part of the result.
- **Isolation, fixed during the dev pipeline check.** The first smoke run picked up the
  user's personal skills from `~/.agents/skills`. One of them, a "brainstorming" skill,
  made Codex stop after planning. Codex runs now use an empty `HOME`, with `CODEX_HOME`
  left pointing at the real `~/.codex`, so the login is used in place and never
  copied. Only Codex's built-in skills load. The smoke runs are not part of the
  result.
- **Outcome: void.** The ChatGPT plan behind the Codex login hit its usage limit
  early in the run ("try again at Nov 20th, 2026"). Most runs never reached the model,
  and the grader scored those as fails. The data is kept in `bench/results/void/` and is
  not reported as a result. Running it again needs more Codex quota, which is the
  user's decision. The runner is ready: `run.ts --agent codex`.

**D-46: More runs on two more Claude accounts, recorded before running.** The user
added two accounts (acct2, acct3). About $40 of the ~$100 budget is left.

*Planned runs:*
- **I** (acct3): Opus 5.5 as the agent; `none` vs `rules`; fresh-test, exec, terse,
  seeds 1–2. Hypothesis: rules > none. Opus is the strongest model, so the unaided pass
  rate may leave little headroom. A null result is reported as such.
- **J** (acct2): Haiku 5.5, exec, terse; `none, rules, hook, cards, cards-warn`;
  fresh-test, seeds 1–2. This fills the one missing cell, Haiku with shell access.
  Hypothesis: rules > none.
- **Finishing the real-repo cards** (acct2). The three repos in `real-usage.ts` were
  cut short by the first account's session limit.

*Error handling:* any run that errors (a rate limit, or zero cost) is rerun, not
scored as a fail.
- **Outcome.** Every session in both runs reached the model: no retries, no errors.
  - Run I (Opus): rules 41/42 vs none 39/42, 2–0, p = 0.5. Same direction, not
    significant.
  - Run J (Haiku, exec): rules 41/42 vs none 37/42, 5–1, p = 0.22.
  - The real-repo cards were finished: 128, 208 and 34 carded issues.
