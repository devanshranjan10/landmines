# Datasheet: landmine-bench v0

Follows the questions in *Datasheets for Datasets* (Gebru et al.), shortened.

## Motivation

- **Purpose.** To measure whether coding agents, and tools that give them context, avoid
  bugs that are already known and filed upstream against the exact dependency version a
  project pins. No public benchmark measured this (see README § Why a new benchmark).
- **Creators.** The landmine project, built with Claude Code agents under human
  direction. Every task was machine-validated fail→pass.
- **Funding.** None. Agent runs were paid from the authors' own accounts.

## Composition

- **Instances.** 66 tasks. Each is a small project, a feature request in two phrasings
  (spec and terse, fresh set only), a hidden test, a naive solution and a workaround
  solution.
- **Sets.**
  - Fresh: 31 tasks (23 Python, 8 npm) from issues opened on or after 2026-07-01.
  - 2024: 35 tasks (22 Python, 13 npm) from late-2024 issues.
- **Splits.** Package-level and seeded (20261021), frozen before any tuning:
  - fresh: 10 dev, 21 test;
  - 2024: 17 dev, 18 test.
- **Labels.** The hidden test decides pass or fail. A trigger regex flags whether the
  bug's triggering pattern is still in the final code. This is a diagnostic, not the
  score.
- **Sampling.** Tasks are not a random sample of bugs. Each was chosen from landmine's own
  index (open issues that name the exact version and are tied to code symbols) and had
  to have a reproducer and a workaround. The benchmark therefore covers known bugs with
  workarounds, the case landmine is designed for.
- **Personal or sensitive data.** None in the tasks. The fixture cache contains public
  GitHub issue text and usernames, used for the landmine arms' offline index.
- **Third-party content.** The issue threads in `fixtures/` (see License).

## Collection

- **Issue sources.** Public GitHub repositories of the packages listed in README,
  fetched through the GitHub API on 2026-10-21. The raw responses are frozen in
  `fixtures/cache`.
- **Task authoring.** Agents wrote projects, prompts, tests and references from each
  issue's reproducer and thread. `scripts/bench/validate.ts` checks every task, and the
  frozen results are in `validation.json`.
- **Terse prompts.** A separate agent rewrote each fresh prompt under one fixed rule:
  - remove only the sentences that prescribe the edge-case behaviour;
  - keep the interface and the data facts.

  These were not tuned to results. Three are flagged borderline in `tasks/TERSE.md`.
- **Timeframe.** Issues run from 2024 to 2026-10. Tasks were built 2026-10-21.

## Preprocessing

- **Projects.** Pinned with real lockfiles: package-lock.json, or exact requirements.
- **Python environments.** Frozen in `env/requirements-*.txt`.
- **Canary.** A GUID is added to every `task.json` and hidden test. Prompts and projects
  carry no canary, so agents never see it.

## Uses

- **Intended.**
  - Comparing agents, models and context tools on known-bug avoidance.
  - Ablations of how bug information is delivered (instructions file, pre-edit hook, MCP
    server, web search).
- **Not intended.**
  - Measuring how many bugs a tool *finds* (recall). Selection makes this impossible.
  - General coding ability.
  - Training data. See the canary.
- **Known risks.**
  - Results on 21 tasks are noisy. Use several seeds and paired runs.
  - A model trained after the fresh issues' dates may know them. Check its cutoff, and use
    a refreshed set.

## Distribution

- **License.** Task data is CC BY 4.0, code is MIT, and `fixtures/` is third-party issue
  text (see README § License).
- **Where.** In this repository under `bench/`.

## Maintenance

- **Errors and removal requests.** Open an issue on the repository.
- **Refreshes.** New versions add tasks from newer issues. Existing tasks stay, as
  controls.
- **Submissions.** `bench/submissions/<name>/` and `scripts/bench/leaderboard.py` (README
  § Submitting results).
