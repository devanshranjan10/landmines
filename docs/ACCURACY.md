# Accuracy

Measured on 2026-10-21. All labels were assigned by hand by the AI agent that built
landmine (Claude): one labeller, no second rater, and the labeller knew what the tool
was trying to do. Treat these numbers as an honest first measurement, not a benchmark.
Every label is in `eval/` so you can check them.

Two questions are measured separately:

1. **Index quality.** For an issue landmine says is filed against your exact version
   and armed against a symbol, is that true?
2. **Hook quality.** When the hook would fire on real code, is it worth interrupting
   for?

Recall, meaning how many bugs that a project actually hits landmine catches, is
**not measured**. That needs ground truth we don't have.

## 1. Index quality (held-out samples)

Two projects pin popular packages at their October 2024 versions. None of these
packages were used while building or tuning the analysis.
- Set A: 31 packages, `eval/heldout`.
- Set B: 44 packages, `eval/heldout-b`.

From each, 40 armed landmines (unique issues the hook could fire on) were drawn at
random with a fixed seed: `scripts/accuracy-sample.ts`.

| Criterion | Meaning |
|---|---|
| **Version** | The reporter, or a commenter confirming it, actually ran that exact version and saw the bug. |
| **Symbol** | *yes*: using the top armed symbols is how you hit the bug. *partial*: the bug's API is armed, but not on top, or next to a broad symbol. *no*: unrelated, e.g. a user's variable or another library's API. |
| **Workaround** | Among issues where landmine quotes a workaround, does the quote actually offer a way around the bug? |

| Sample | Code | Version correct | Symbol yes / partial / no | Workaround genuine |
|---|---|---|---|---|
| A (seed 20261021) | before any held-out fixes | 31/40 (78%) | 18 / 4 / 18 | 4 of 7 |
| B (seed 20261022) | after the fixes from A | 33/40 (82.5%) | 18 / 4 / 18 | 4 of 9 |

Labels: `eval/labels/sample-a-baseline.json` and `eval/labels/sample-b-final.json`.

**What went wrong.**

Version errors in A came from several causes:
- another package's version that happened to be the same string (`amqp==5.4.0`,
  `matplotlib: 2.2.3`, `"@types/jsonwebtoken": "^9.0.2"`)
- "passes on X"
- "works just fine on X"
- a version inside pip's long version list

All of these were fixed generically before B was drawn. In B, 6 of the 7 version
errors had one cause: PyTorch nightlies (`2.5.0.dev20240708`) counted as 2.5.0. The
seventh was a question ("is this moot with 6.0.2?").

Most "no" symbols are inert. Timezone names, test names, error-code constants and
users' column names never match real code, so they never fire. The harmful ones are
broad symbols that would fire on ordinary code:
- `DataFrame`, `bfloat16`, `plotly.express`, `cuda`
- the *working* alternative an issue names (`np.ma.ptp`, `boxplot`)

**After the fixes from B.** This is in-sample, *not* a held-out result. Re-analyzing
the same issues after the B fixes:
- 6 of B's 7 version errors and 8 of A's 9 are no longer armed.
- 32 of B's 33 correct ones are still armed. So are 23 of A's 31. Of the 8 no longer
  armed in A:
  - 5 had symbols labelled wrong (dropping them is an improvement)
  - 2 are docs or feature issues, now deliberately excluded
  - 1 (`numpy.ma.min`) is a real recall loss from the namespace rule

## 2. Hook quality on real code

**Setup.**
- Real source files that import these packages, fetched from public GitHub repos with
  code search: `scripts/fetch-real-files.ts`, 3 files for each of 20 packages.
- Manifests are in `eval/realcode/`. Only paths and SHAs are stored, not the code.
- Each file goes through `landmine check` against the held-out indexes. That treats
  the whole file as newly written, which is the worst case; a real edit touches far
  less.
- For each hit, the label asks: does the code plausibly meet the condition the issue
  describes?

| Set | Role | Files | Files with a match | Would block | Matches judged relevant |
|---|---|---|---|---|---|
| C1 | before corroboration existed | 60 | 17 | 17 (all matches blocked) | 2 relevant + 1 partial of 28 |
| C2 | tuning the corroboration rule | 60 | 8 | 0 | (tuning set) |
| C3 | **held out, final rules** | 60 (60 new repos) | 13 | **1** | block: 0 of 1 · other matches: 2 partial of 27 |

Labels: `eval/realcode/labels-c1.json`, `eval/realcode/labels-c3.json`, and
`c1-c2-tuning-summary.json`.

**What this means.**
- **Matching on symbols alone is mostly noise.** In C1, 25 of 28 matches used the right
  API without the bug's triggering condition. Examples:
  - `jwt.verify` without the `audience` option, against a ReDoS that needs an
    `audience` RegExp
  - `fillna(0)` on numbers, against a `fillna('')`-on-NaT bug
- **Hence corroboration (D-27).** A match only blocks when the file also uses, as the
  package's API, a second symbol the issue names in prose: an option, sibling API or
  driver import. Either that symbol or the matched one must also be in the title.
- **On held-out real code the final rules blocked 1 file in 60, and that block was a
  near miss.** The file calls `jwt.sign` with the `issuer` option, but synchronously
  and with an empty payload. The bug needs the callback form and a payload that
  already has `iss`.
- **So there is no held-out evidence yet of a relevant block on random code.** The
  demonstrated relevant block is the drizzle-orm#3402 case in `docs/e2e`. It is a demo
  project, but `db.$client.end()` was the agent's own unprompted first attempt, and
  both Claude Code and Codex changed approach and cited the issue.
- **Uncorroborated matches are about 7% relevant (2 partial of 27).** For that reason
  they are **off by default** (D-29). `--heads-up` passes them to the agent as
  non-blocking context, and `--mode warn` turns every match into context.

## 2b. Trigger cards (v0.2)

`landmine cards` has a model write one card per issue. The hook checks cards offline.
- **What was carded.** All 523 issues behind landmine-bench, plus the 254 issues of a
  real 46-dependency project. Claude Opus wrote them through the Claude Code CLI.
- **What the cards say.** Of the bench's 523:
  - about 20% were judged not a bug, or not in the pinned version, which disarms them;
  - about 7% failed the self-check (the issue's own repro code does not satisfy the
    card) and are disarmed too.

**Trap track.** Offline, fresh-dev, tuned on these same tasks:
- cards block **10/10** naive solutions, against 4/10 for the heuristic hook;
- cards also block 4/10 correct solutions, against 2/10.

**False blocks on real code.** Same method as §2: whole files, worst case, labelled by
an Opus judge that sees the file and the issue's condition. R2 is 150 files from repos
not used anywhere else, checked after the policy froze:

| Arm | File × version pairs blocked | Blocks plausibly relevant | Clearly relevant |
|---|---|---|---|
| heuristic hook | 2/192 | 0/2 | 0 |
| cards | 29/192 (15%) | 9/34 | 0 |

- **Cards interrupt far more often than the heuristic hook.** About three quarters of
  those interruptions do not apply.
- **Their main blind spot is semantic conditions tokens can't express:**
  - "named import under native ESM" (jsonwebtoken#963);
  - "an array of objects, not arrays" (PapaParse#1174);
  - "a numeric character reference in the input" (fast-xml-parser#892).
- **They earn their keep elsewhere.** Cards' main value turned out to be better
  *text* for the rules section (the condition and the workaround), not better
  matching. On landmine-bench the rules section beat every hook arm
  ([`BENCHMARK.md`](BENCHMARK.md)).

## 3. Things that limit recall (not measured)

- **Only open issues that literally name the exact version string are found.**
  - Issues that say "since 2.5" or "on 3.x" are missed.
  - So are issues that never state a version.
  - So are bugs that were fixed in a later release you haven't upgraded to: those
    issues are closed.
- **GitHub search is not stable.** On 2026-10-21 identical queries returned different
  counts minutes apart, including hits that did not contain the version at all
  (RESEARCH §2). landmine verifies every hit locally, so this costs recall, not
  precision.
- **At most `--max-issues` (default 100) issues are fetched per package version**,
  sorted by reactions.
- **Only direct dependencies are checked.**
- **Packages not hosted on GitHub are skipped.** In the held-out sets that was Django
  (issues disabled).

## Reproduce

```sh
npm run build
(cd eval/heldout && node ../../dist/cli.js scan)          # needs a GitHub token
npx tsx scripts/accuracy-sample.ts eval/heldout 40 20261021
npx tsx scripts/fetch-real-files.ts /tmp/lm-realcode-c3 eval/realcode/manifest-c3.json 3 eval/realcode/manifest-c1.json
```

GitHub search results change over time, so a re-run will not reproduce these exact
samples. The labelled items are recorded in `eval/`.
