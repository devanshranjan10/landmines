# Progress

This is the resume point for any session.

**v0.1:**
- Plan: `docs/superpowers/plans/2026-10-21-landmine.md`.
- Spec: `docs/superpowers/specs/2026-10-21-landmine-design.md`.

**v0.2** (benchmark, trigger cards, every agent):
- Spec: `docs/superpowers/specs/2026-10-21-landmine-v0.2-design.md`.
- Plan: `docs/superpowers/plans/2026-10-21-landmine-v0.2.md`.

**Reference docs:**
- Decisions: `docs/DECISIONS.md`, D-01 to D-44. D-33 onward cover v0.2.
- Benchmark: `docs/BENCHMARK.md`.
- Accuracy: `docs/ACCURACY.md`.
- Live runs: `docs/e2e/README.md`.

## Status

v0.1 (M0–M10) and v0.2 (M11–M16) are done and committed. The gate is typecheck,
lint, 311 offline tests and build, and it passes. Nothing was published, pushed or
posted.

---

## Morning summary (v0.2, 2026-10-21)

### What works (each item verified by running it)

- **landmine-bench v0** (`docs/BENCHMARK.md`).
  - 66 trap tasks, each validated fail→pass:
    - 31 "fresh" tasks from issues opened after the model's training cutoff;
    - 35 from 2024, kept as a contaminated control.
  - Frozen package-level dev/test splits.
  - Five to eight arms per run, run headless through Claude Code with Sonnet 5.5 and
    Haiku 5.5. There are 1,171 graded runs, for $59.76 of metered agent cost.
  - Offline trap track and a real-code false-block track, the latter with a tuning set
    and a held-out set.
- **The headline result.** The `landmine rules` section in CLAUDE.md is the best arm.
  - On the fresh test split (Sonnet, shell access, user-style prompts, 4 seeds) it
    passed 83/84 tasks against 72/84 unaided.
  - A run pre-registered before it ran confirmed it: 6 wins, 0 losses, p = 0.03.
  - It ranked first in every fresh configuration, tying with context-only cards on
    Haiku.
  - On the contaminated 2024 set every arm ties, because the model already knows those
    bugs.
- **Trigger cards** (`landmine cards`). One model call per issue, cached, with
  Anthropic API, OpenAI-compatible or Claude-Code-login providers.
  - Verified end to end through the CLI with a Claude Code login.
  - 523 bench issues and 254 issues of a real project were carded with no failures.
  - The rules section uses cards' condition and workaround text.
- **20 agents in one normaliser.** Payload shapes and deny formats for:
  - **Hooks:** Claude Code, Codex, Cursor, Gemini CLI, Copilot, Windsurf/Devin, Droid,
    Auggie, Kiro, Qwen, Crush, Goose, OpenHands, Trae, Antigravity.
  - **In-process plugins:** OpenCode, Kilo, Cline, Amp, Pi.

  Install and uninstall are tested for each agent, and the plugins are executed in
  tests against stub hosts.
- **For agents without a pre-edit hook** (Freebuff, Aider, Zed, Roo, Continue,
  Warp…):
  - `rules --write`, `rules --skill` (`.agents/skills/landmine/SKILL.md`);
  - `install --mcp` for 16 agents' MCP configs;
  - `check --staged` for pre-commit or CI.
- **Rules ranking.** `install --rules` writes AGENTS.md and CLAUDE.md, ranked by what
  your code uses. `uninstall` removes every file and section it wrote.
- **Hook speed.** 0.11 s per call with a carded index.

### What doesn't, or isn't proven

- **The pre-edit hook doesn't measurably help on this benchmark.**
  - Neither the heuristic hook nor card matching beat no help with significance: cards
    9–3 (p = 0.15), heuristic hook 8–5 (p = 0.58).
  - The two cases behind that:
    - The hook can't see a bug whose trigger lives in code the agent didn't edit
      (polars-30043).
    - A warning doesn't guarantee a working workaround (networkx-8964).
  - With Haiku, *blocking* cards were no better than nothing (31/42), while the same
    cards as context matched rules (37/42).
- **Cards interrupt real code too often.**
  - On 150 held-out public files, cards would block 15% of file × version pairs. About a
    quarter of those blocks plausibly apply, and none clearly does.
  - The heuristic hook blocks 1%, and none of those apply.
  - Tokens can't express semantic conditions such as "named import under native ESM".
- **The rules list is short.** In a big project only 15 issues fit.
  - Simulated with a real 46-dependency project's issues mixed in: confidence ranking
    lost the whole gain, while usage ranking kept it, but that simulation flatters
    usage ranking.
  - In three real repos, issues whose API the code already uses numbered 9, 20 and 4,
    so the list mostly fits.
  - When the agent introduces an API the code doesn't use yet, the list can miss it.
- **Selection bias.** Every trap is a bug landmine had already indexed. Recall is still
  not measured.
- **Prompt wording.** The "terse" prompts were added after seeing dev baselines (D-40).
  The tool's win holds with the fully specified prompts too, but the effect is smaller
  there: 21/21 against 19/21.
- **The Codex benchmark is void.** It was attempted (D-45), but the ChatGPT plan's
  Codex quota ran out a few runs in; it resets on 2026-11-20. The Codex runner works and
  is ready to rerun.
- **Only Claude Code was benchmarked.** The other 19 agents are built from their docs
  and source and tested with payloads in their shapes.
  - OpenCode: a live run failed on the user's GMI Cloud provider ("Insufficient
    balance"), not on landmine.
  - Cursor: `cursor-agent` isn't logged in.
- **Disclosed slips:**
  - **Test-target card shapes.** I printed the card shapes of the fresh-test targets
    while choosing policy; nothing was changed as a result (D-40).
  - **Arms added after run A.** `rules+cards` and the noisy-rules arms were added after
    run A, so claims about them rest on later runs only (D-42, D-43).

### Needs your decision

1. **Positioning.**
   - The measured value is in the *known-bugs section the agent reads up front*
     (`install --rules`), not in the interruption.
   - Do you want to reposition landmine around "the open bugs in your exact versions,
     in your agent's instructions", with the hook as a backstop?
   - Or should the hook be made opt-in?
2. **Hook default for card matches.** Keep block-once, or switch card matches to
   context-only (`--mode warn`)? Haiku data leans toward context. Sonnet showed no
   difference.
3. **Publish?** Nothing is published. `landmines` was free on npm on 2026-10-21.
   When landmine is run through npx, `install` writes hooks and plugins that call
   `npx -y landmines@0.1.0 hook`, and those only work once the package is published.
   Until then, install from the checkout, which writes `node /abs/path/dist/cli.js`.
4. **Repo contents before anything goes public.** These files need a review:
   - `bench/results/*.jsonl`: run metadata, no transcripts;
   - `bench/realcode/*.json`: public file paths and SHAs plus model labels;
   - `bench/fixtures/cache`: public issue text;
   - `bench/fixtures/noise-fresh-a.json`.
5. **Codex quota.** Rerunning the Codex arm (`run.ts --agent codex --arm none,rules
   --split fresh-test --prompt terse --seeds 2`) needs a plan with more Codex usage, or
   waiting until 2026-11-20.
6. **More benchmark spend.** About $60 of the ~$100 is used. Options for the rest:
   - more seeds;
   - a second agent (Codex) on the rules arm;
   - a fresh-task set built from issues landmine did *not* pick, for recall.

## Next (if continuing)

- Benchmark another agent: Codex, and OpenCode once a provider has balance.
- Recall: traps built from bugs found outside landmine's index.
- Real-world inclusion: run `rules` on more real repos and check whether bugs the agent
  later hits were in the list.
- Cards: use workaround text in the hook message more prominently, and try `unless`
  tokens from the actual fix commits.

## Blocked

Nothing blocking.
- Cursor live runs need `cursor-agent` logged in.
- The default Claude login hit its session limit at the end of the night (it resets at
  6:10 pm IST). All benchmark runs had already finished cleanly; only the extra
  real-repo carding was cut short, and its partial state is stated.
