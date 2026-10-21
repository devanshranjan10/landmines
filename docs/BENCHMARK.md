# landmine-bench v0

A benchmark for one question: **when a dependency version you pin has an open bug that
your coding agent is about to walk into, does landmine help the agent avoid it, and
what does it cost?**

No public benchmark measures this (docs/research/eval-and-benchmarks.md), so this one
was built for the purpose. Every claim in the README is scoped to "landmine-bench v0".
The decisions behind each choice are D-33 to D-42 in [`DECISIONS.md`](DECISIONS.md).

## What a task is

Each task is a small, realistic project that pins a library version with an open,
reproducible bug (a "trap"). The task directory holds:
- `prompt.txt` (spec) and, for the fresh set, `prompt-terse.txt`: a feature request
  whose natural implementation runs into the bug;
- `project/`: the code the agent edits;
- `hidden/`: a test the agent never sees;
- `reference/naive` and `reference/fixed`: a solution that hits the bug and one that
  avoids it;
- `task.json`: the pinned version, the issue, and a regex for the trigger.

**Validation.** `scripts/bench/validate.ts` checks every task fail→pass:
- the untouched seed fails the hidden test;
- the naive solution fails;
- the fixed solution passes;
- the trigger regex matches the naive solution and not the fixed one.

All 66 tasks pass validation.

**Two sets.**
- **2024 (35 tasks).** Bugs from late-2024 versions. Claude 5.5 models already know
  them: unaided Sonnet and Haiku solved the dev half almost perfectly. This set is a
  *contaminated control*.
- **Fresh (31 tasks).** Issues opened on or after 2026-07-01 against current releases,
  after the models' training cutoff. **This set is the headline.**

**Frozen splits.** Each split is package-level and seeded (20261021), so tuning on dev
never sees a test package:
- 2024: 17 dev / 18 test;
- fresh: 10 dev / 21 test.

Card prompts and policy were tuned on dev only (D-38, D-40).

**Prompt styles (fresh set).**
- **spec:** states every requirement, including the edge case the bug breaks.
- **terse:** the same request phrased the way a user would ask. It keeps the data
  facts that make the edge case happen.

Terse prompts were written by a separate agent under one fixed rule and were not
tuned to results ([`bench/tasks/TERSE.md`](../bench/tasks/TERSE.md)). They were added
after seeing that spec prompts left no headroom on dev (D-40), and that change
favours the tool. Three are flagged borderline.

## Arms

| Arm | What the agent gets |
|---|---|
| none | nothing |
| rules | the `landmine rules` section in CLAUDE.md, built from the index and trigger cards |
| hook | the v0.1 pre-edit hook, symbol heuristics only |
| cards | the pre-edit hook with trigger cards; blocks once per issue |
| cards-warn | the same, but passes matches as context and never blocks |
| rules+cards | rules section plus card hook (added after run A, D-42) |

Every landmine arm starts from the same index, rebuilt offline from frozen raw GitHub
data (`bench/fixtures/cache`). Cards are frozen in `bench/fixtures/cards`: 523
issues, written once by Claude Opus through `scripts/bench/gen-cards.ts`. The card
model sees only the issue thread, never the task.

## Harness

`scripts/bench/run.ts` runs one headless `claude -p` session per (task, arm, seed):
- the model is pinned (`sonnet` or `haiku`, Claude 5.5);
- `bypassPermissions`, project settings only, strict MCP config;
- no web access, at most 40 turns;
- the working copy lives in a temp directory outside the repo, so hidden tests,
  references and git history are invisible.

Conditions:
- **exec:** the agent may run shell commands and tests;
- **edit-only:** no Bash.

**Grading.** The hidden test decides pass or fail. Each run also records:
- whether the trigger is still in the final code;
- whether the hook fired or denied, and on which issues;
- whether the agent named the issue;
- cost and turns.

## Results

### Headline: fresh-test, Sonnet 5.5, exec, terse prompts

Two runs on the 21 held-out fresh tasks: run A (seeds 1–2, planned before any test
data) and run F (seeds 3–4, a confirmatory run pre-registered in D-42 before it ran).

| Arm | Run A | Run F (confirmatory) | Total | Mean cost per run | Mean turns |
|---|---|---|---|---|---|
| none | 36/42 | 36/42 | 72/84 (86%) | $0.061 | 6.2 |
| **rules** | **41/42** | **42/42** | **83/84 (99%)** | $0.069 | 6.1 |
| hook (v0.1 heuristics) | 35/42 | 37/42 | 72/84 (86%) | $0.063 | 6.5 |
| cards (hook, blocks) | 38/42 | 38/42 | 76/84 (90%) | $0.064 | 6.4 |
| cards-warn (hook, context only) | 35/42 | 39/42 | 74/84 (88%) | $0.064 | 6.3 |
| rules+cards | n/a | 41/42 | 41/42 | $0.073 | 6.4 |

**Pre-registered tests (run F only):**
- **H1, rules > none: confirmed.** 6 wins, 0 losses, exact McNemar p = 0.031.
- **H2, rules+cards ≥ rules: not shown.** 0 wins, 1 loss. The card hook added nothing
  on top of the rules section.

### Against the alternatives (run K, D-47)

Do you need landmine, or would web search or a docs MCP server do? Same 21 held-out
tasks, Sonnet 5.5, shell access, terse prompts, seeds 1–2, with all four arms in one
batch. Every session reached the model.

| Arm | Passed | rules vs this arm |
|---|---|---|
| **landmine rules section** | **42/42** | n/a |
| web search on (WebSearch + WebFetch, so the agent can search GitHub issues) | 36/42 | 6–0, p = 0.03 |
| no help | 35/42 | 7–0, p = 0.016 |
| Context7 MCP (`@upstash/context7-mcp@4.4.4`) | 35/42 | 7–0, p = 0.016 |

- **Both hypotheses recorded in advance were confirmed.**
- **The alternatives were never used.** In all 84 sessions of the two alternative arms
  the agent never searched the web and never called Context7. The tools were available
  and connected; the agent didn't think to look. Context7 serves documentation,
  which these bugs are not in. Web search would have found most of the issues, but only
  if the agent had asked.
- **Limit.** Nobody told those arms to check for known bugs. They got the same
  prompt as every other arm, as a real user's agent would. An agent explicitly told to
  search for open issues would be a stronger baseline, and that was not run.

### Every configuration

| Run | Model | Condition | Prompt | none | rules | hook | cards | cards-warn |
|---|---|---|---|---|---|---|---|---|
| A | Sonnet | exec | terse | 36/42 | 41/42 | 35/42 | 38/42 | 35/42 |
| F | Sonnet | exec | terse | 36/42 | 42/42 | 37/42 | 38/42 | 39/42 |
| B | Sonnet | edit-only | terse | 16/21 | 20/21 | 18/21 | 19/21 | 18/21 |
| C | Sonnet | exec | spec | 19/21 | 21/21 | 19/21 | 20/21 | 20/21 |
| D | Haiku | edit-only | terse | 31/42 | 37/42 | 33/42 | 31/42 | 37/42 |
| J (D-46) | Haiku | exec | terse | 37/42 | 41/42 | 37/42 | 38/42 | 38/42 |
| I (D-46) | Opus | exec | terse | 39/42 | 41/42 | n/a | n/a | n/a |
| E: 2024 set (contaminated control) | Sonnet | exec | spec | 17/18 | 17/18 | 17/18 | 17/18 | n/a |

Paired over the planned fresh runs A–D (126 pairs per comparison):

| Comparison | Wins–losses | Exact McNemar p |
|---|---|---|
| rules vs none | 20–3 | 0.0005 |
| rules vs none, excluding the 3 borderline terse tasks | 16–3 | 0.004 |
| rules vs cards | 13–2 | 0.007 |
| rules vs cards-warn | 12–3 | 0.035 |
| cards-warn vs none | 11–3 | 0.057 |
| cards vs none | 9–3 | 0.15 |
| hook vs none | 8–5 | 0.58 |

On the contaminated 2024 set, every arm scores 17/18: the model already knows those
bugs.

**Runs I and J** (D-46) were recorded before running, on two more Claude accounts.
Every session reached the model: no retries, no errors.
- **Opus 5.5 (run I):** rules 41/42 against 39/42, 2–0, p = 0.5. Same direction, not
  significant. Opus fails few of these tasks unaided, and both rules wins came on
  date-fns-4384, the most borderline task.
- **Haiku 5.5 with shell access (run J):** rules 41/42 against 37/42, 5–1, p = 0.22.
  Rules came first again; every hook arm was within one task of none.
- **All 252 fresh-test pairs pooled** (runs A, B, C, D, F, I, J; three models; both
  conditions; both prompt styles): rules beat none **33–4**, exact McNemar
  p ≈ 1 × 10⁻⁶. The pairs share tasks, so this p-value overstates independence. The
  per-run results and the pre-registered run F are the cleaner evidence.

### What this means

- **The static rules section is the best measured arm on landmine-bench v0.** It is
  ahead in every fresh configuration, and its advantage held up on unseen seeds. It
  works because the agent reads it before it plans.
- **The pre-edit hook adds little.** Neither the heuristic hook nor card-based matching
  is significantly better than nothing.
- **Why the hook adds little, case by case:**
  - **The hook can't see the bug's code.** On polars-30043 the bug lives in how a
    *writer* records statistics, while the agent only edits the reader. The card hook
    never fires; the rules section prevents the bug.
  - **A warning that isn't enough.** On networkx-8964 the card hook fired in every run
    and the agent cited the issue, but its workaround still failed the hidden test.
  - **Blocking can hurt a weaker model.** With Haiku, blocking cards scored 31/42, the
    same as no help, while the same cards as context scored 37/42.
- **Cost.** The rules section adds about 12% to cost per run (a longer CLAUDE.md) and
  does not add turns.

### The caveat that matters: list length

In the bench, the rules section only lists issues for the task's one indexed package.
A real project has many more, so the 15-item list has to choose.
`scripts/bench/rules-inclusion.ts` merged each task's issues with those of a real
46-dependency project (173 issues armed by cards). Ranked by card confidence, the
target issue made the top 15 for only **2/21** test tasks, and the top 60 (the
`--skill` list) for 12/21.

`landmine rules` now ranks by usage: issues whose APIs the project's code already
calls come first. The target API was already in the seed code for 11/21 test tasks.

**Measured (run G, D-43; prediction recorded before it ran).** Each task's index was
mixed with the real project's 254 carded issues. Seeds 1–2, paired with run A:

| Arm | Passed | vs none |
|---|---|---|
| none (run A) | 36/42 | n/a |
| rules, task package only (run A) | 41/42 | 5–0 |
| **rules-noisy-conf** (mixed index, confidence ranking) | **35/42** | 1–2, p = 1.0 |
| **rules-noisy** (mixed index, usage ranking) | **42/42** | 6–0, p = 0.03 |

- **Confidence ranking in a big project** loses the whole advantage, as predicted.
- **Usage ranking** keeps it. It is flattered here, though: the noise packages are not
  imported by the task project, so usage ranking pushes them all down.

**How much competition there is in real repos** (`scripts/bench/real-usage.ts`). Three
public repos were cloned, scanned and fully carded:

| Repo | Packages | Armed issues | API already used (usage 2) | Package imported, API not used (usage 1) |
|---|---|---|---|---|
| expense.fyi (Next.js app) | 61 | 48 | 14 | 6 |
| page-spy-web (web app) | 77 | 87 | 26 | 48 |
| zpy (Python) | 7 | 23 | 4 | 16 |

**Realistic reading.**
- When the bug's API is already used somewhere in the codebase, the 15-item list
  contains it in smaller repos (expense.fyi, zpy). That was true for the seed projects of 11/21 test tasks.
- In larger repos even the usage-2 group can overflow 15 items: page-spy-web has 26.
- When the agent reaches for an API from an imported package that the code doesn't
  use yet, a large repo can crowd it out: page-spy-web has 48 such issues.
- `--skill` (60 items) and `landmine_search` over MCP are the fallbacks.

## Offline tracks (no agent)

**Trap track** (`scripts/bench/offline.ts`). The naive and fixed reference files are
fed through the hook as if the agent wrote them. Results on fresh-dev, after the card
prompt was tuned on it:

| | heuristic hook | cards |
|---|---|---|
| naive solution blocked on its issue | 4/10 | 10/10 |
| fixed solution blocked on its issue (a wasted turn) | 2/10 | 4/10 |

The four fixed solutions that cards still block add a guard (`max(1, …)`, an
empty-input check, `Object.hasOwn`) that token matching cannot see.

**Real-code false-block track** (`scripts/bench/realcode.ts`).
- **Data.** Public GitHub files that import a bench package (6 per package, 25
  packages, forks/tests/examples skipped). Each whole file is checked against every
  bench version of its package, which is the worst case, since a real edit touches
  far less.
- **Labels.** Each block is labelled by a Claude Opus judge that sees the file and the
  issue's condition, but not the arm. The labels for R2 were spot-checked by hand
  (`bench/realcode/labels*.json`).
- **Sets.**
  - R1 was used while choosing policy.
  - R2 is 150 files from repos not in R1, checked once after the policy froze.

| Set | Arm | File × version pairs blocked | Blocks plausibly relevant | Clearly relevant |
|---|---|---|---|---|
| R1 (tuning) | hook | 13/192 | 3/16 | 0 |
| R1 (tuning) | cards | 43/192 | 11/56 | 0 |
| **R2 (held out)** | hook | **2/192** | 0/2 | 0 |
| **R2 (held out)** | cards | **29/192** | 9/34 | 0 |

**Reading.** Cards block about 15% of real files as written, and about a quarter of
those blocks plausibly apply. The main failure is semantic conditions that tokens
cannot express:
- "named import under native ESM" (jsonwebtoken#963);
- "an array of objects, not arrays" (PapaParse#1174);
- "a numeric character reference in the input" (fast-xml-parser#892).

Each block costs the agent one retry. The hook blocks once per issue per session.

## Tasks

The trap for each task is summarised from `task.json`. Fairness notes for the terse
prompts are in [`bench/tasks/TERSE.md`](../bench/tasks/TERSE.md).

### fresh set

| split | task | pinned | issue | the trap |
|---|---|---|---|---|
| dev | arrow-1341 | arrow@1.4.0 | arrow-py/arrow#1341 | Arrow.dehumanize() mis-parses fractional amounts: '1.5 hours ago' shifts by 5 hours and '0.5 days ago' by 5 days, silently |
| test | csv-parse-536 | csv-parse@7.0.3 | adaltas/node-csv#536 | csv-parse with bom: true + trim: true corrupts UTF-16LE input: BOM detection switches the encoding but trim still strips UTF-8 whitespace bytes |
| test | date-fns-4384 | date-fns@4.4.0 | date-fns/date-fns#4384 | formatDistanceStrict rounds after picking the unit, so 59.5 s reads "60 seconds", 59.5 min "60 minutes", 23.99 h "24 hours" instead of rolling over |
| test | dayjs-3279 | dayjs@1.11.23 | iamkun/dayjs#3279 | dayjs.duration('-PT15M') ignores the leading sign and returns +15 minutes |
| test | fast-xml-parser-892 | fast-xml-parser@5.11.2 | NaturalIntelligence/fast-xml-parser#892 | fast-xml-parser decodes &amp;/&lt; by default but leaves numeric character references (&#233;, &#xE9;) undecoded unless htmlEntities is enabled |
| test | networkx-8964 | networkx@3.6.1 | networkx/networkx#8964 | minimum_spanning_arborescence raises 'No minimum spanning arborescence in G' on some graphs that have one (minimal_branching's weight shift is too small), e.g. a chain with cheap back links |
| test | pandas-67949 | pandas@3.0.5 | pandas-dev/pandas#67949 | pd.to_numeric(errors='coerce') on an ArrowDtype string column turns unparseable values into float NaN instead of a missing value: isna() is False for them and sum() returns nan |
| test | pandas-68026 | pandas@3.0.5 | pandas-dev/pandas#68026 | DataFrame.to_xml writes bool values with str(), i.e. 'True'/'False', which are not valid xs:boolean values |
| test | pandas-70811 | pandas@3.0.6 | pandas-dev/pandas#70811 | Series.str.get_dummies with a multi-character separator such as ' / ' on object/categorical dtype splits it as a regex (on the spaces) and then matches literally, producing wrong column names and all-zero indicators |
| test | pandas-71280 | pandas@3.0.6 | pandas-dev/pandas#71280 | DataFrame.to_stata with convert_dates 'tw' computes the week as day_of_year // 7 without capping at 51, so Dec 31 (and Dec 30 in leap years) is written as week 1 of the next year |
| test | pandas-71282 | pandas@3.0.6 | pandas-dev/pandas#71282 | pd.cut on an object-dtype Series that contains NaN assigns some later values to the wrong bin (silently), e.g. 95 lands in the lowest bin |
| dev | papaparse-1174 | papaparse@5.7.0 | mholt/PapaParse#1174 | Papa.unparse builds the header from the first object's keys only; keys that first appear in later rows are silently dropped |
| test | plotly-5792 | plotly@7.1.0 | plotly/plotly.py#5792 | make_subplots positions row_titles using the last-column cell; when that cell is covered by a colspan (None in specs) the titles shift to the wrong row and the last one is dropped |
| test | plotly-5805 | plotly@7.1.0 | plotly/plotly.py#5805 | plotly.colors.sample_colorscale(scale, 1) (and n_colors(..., 1)) raises ZeroDivisionError instead of returning the start color |
| test | plotly-5827 | plotly@7.1.0 | plotly/plotly.py#5827 | graph_objects string properties such as Scatter(name=...) reject NumPy integer scalars (e.g. values from Series.unique() of an int column) with ValueError, while Python ints are accepted and converted |
| test | polars-30043 | polars@2.0.0 | pola-rs/polars#30043 | Polars' Parquet writer merges UInt64/UInt32 page statistics with a signed comparison, so a row group whose pages straddle 2**63 gets min > true min; scan_parquet filters then skip that row group and silently return no ro |
| test | polars-30081 | polars@2.0.0 | pola-rs/polars#30081 | A LazyFrame sort followed by head()/top_k whose sort keys repeat a column (sort(['a', 'a']).head(k)) is lowered to the streaming TopK node, which collapses the duplicate keys, picks the single-key reducer and panics with |
| test | polars-30105 | polars@2.0.0 | pola-rs/polars#30105 | DataFrame.extend / Series.extend / scatter on a uniquely owned offset slice (e.g. the result of tail()) read the Boolean bitmap and validity from bit 0 instead of the slice offset, so existing Boolean values and nulls ar |
| test | pyarrow-51162 | pyarrow@25.0.1 | apache/arrow#51162 | pa.Table.from_pandas() wraps non-null numeric pandas columns zero-copy without registering with pandas 3 Copy-on-Write, so a later df.loc/iloc cell assignment silently changes the already-built Table |
| test | pyarrow-51368 | pyarrow@25.0.1 | apache/arrow#51368 | pyarrow's CSV reader silently drops the LF of a CRLF inside a quoted field when the CR is the last byte of a parse block (default block 1 MiB), so a multi-line value loses one byte |
| test | pyarrow-51491 | pyarrow@25.0.1 | apache/arrow#51491 | Filtering a Parquet dataset with mm != 0.0 (or ~(mm == 0)) silently drops NaN rows from files whose non-NaN values are all 0.0, because the row group is pruned using min/max statistics that exclude NaN |
| test | pyarrow-54534 | pyarrow@26.0.0 | apache/arrow#54534 | Casting a zoned timestamp to string (used by pyarrow.csv.write_csv) prints the local wall time with an offset truncated to hours:minutes, so instants in zones with second-level offsets (e.g. pre-1883 America/New_York, pr |
| test | pyarrow-54535 | pyarrow@26.0.0 | apache/arrow#54535 | pyarrow.csv.write_csv writes a null of a single-column table as an empty line; read_csv skips empty lines by default, so null rows silently disappear on a write/read round trip |
| dev | rich-4214 | rich@15.0.0 | Textualize/rich#4214 | rich Columns(width=N) raises ZeroDivisionError when the console is not wider than N plus padding, instead of falling back to a single column |
| dev | rich-4216 | rich@15.0.0 | Textualize/rich#4216 | Console.print(Text(..., justify='center')) ignores the Text's own justify (renders left-aligned) unless justify= is also passed to print(); it works inside Panel/Group |
| dev | scipy-26188 | scipy@1.18.1 | scipy/scipy#26188 | scipy.stats.ncf.sf(x, dfn, dfd, nc=0) returns -ncf.cdf(x) (a negative probability) instead of 1 - cdf, so power at effect size 0 comes out as about -0.95 instead of alpha |
| dev | scipy-26406 | scipy@1.18.1 | scipy/scipy#26406 | scipy.signal.lfilter with zi on an empty input returns uninitialised memory as the final state zf (IIR), so a streaming filter's state is corrupted by an empty chunk; sosfilt raises instead |
| dev | scipy-26409 | scipy@1.18.1 | scipy/scipy#26409 | scipy.stats.poisson_binom.sf/logsf compute 1 - cdf, so small upper-tail probabilities (e.g. all 3 replicas with p=1e-6 failing, 1e-18) come out as 0 or ~1e-16 instead of the true value |
| dev | semver-904 | semver@7.8.5 | npm/node-semver#904 | semver.gtr/ltr pick the wrong edge when a comparator set has two bounds on one side (e.g. '^4.17.0 >=4.17.21'), so both can return true |
| dev | yaml-733 | yaml@2.9.1 | eemeli/yaml#733 | yaml.stringify with indent other than 2 writes the wrong block-scalar indentation indicator (/2) for mapping values whose first line starts with spaces, so parse() adds extra leading spaces |
| dev | zod-6666 | zod@4.6.7 | colinhacks/zod#6666 | zod 4 reads Object.prototype members for absent keys, so an optional `constructor` key rejects objects that lack it ("expected string, received function") |

### 2024 set

| split | task | pinned | issue | the trap |
|---|---|---|---|---|
| test | axios-6587 | axios@1.7.7 | axios/axios#6587 | an axios instance created with `auth` overrides a per-request Authorization header, so the Bearer token is replaced by Basic credentials |
| test | date-fns-3873 | date-fns@3.6.0 | date-fns/date-fns#3873 | intervalToDuration returns {months: 1, hours: -3} / {months: 1, days: -1} for intervals just under a month that end near a month end |
| dev | dayjs-2750 | dayjs@1.11.13 | iamkun/dayjs#2750 | dayjs().add(dayjs.duration({ weeks })) adds nothing for the weeks part |
| dev | dayjs-2762 | dayjs@1.11.13 | iamkun/dayjs#2762 | dayjs.duration(ms).hours() etc. are wrong for spans over ~30 days (month/year roll-up since 1.11.10) |
| dev | dayjs-2797 | dayjs@1.11.13 | iamkun/dayjs#2797 | dayjs(str, 'YYYYMMDD HHmmss ZZ', true) is always invalid when the offset differs from the host zone |
| dev | dayjs-2818 | dayjs@1.11.13 | iamkun/dayjs#2818 | dayjs('29.Jul.21', 'DD.MMM.YY') is Invalid Date: '.'-separated month names don't parse |
| dev | dayjs-2901 | dayjs@1.11.13 | iamkun/dayjs#2901 | dayjs('600', 'Hmm') parses as 12:00 PM (and '930' as 9:00 PM) instead of 6:00 / 9:30 |
| dev | dayjs-2938 | dayjs@1.11.13 | iamkun/dayjs#2938 | dayjs(str).isValid() is true for '2025-02-30', '2025-13-01' and free text like 'March 14' (falls back to new Date / rolls over) |
| dev | dayjs-3013 | dayjs@1.11.13 | iamkun/dayjs#3013 | dayjs.utc(str, [formats]) silently parses in local time instead of UTC |
| test | jsonwebtoken-1000 | jsonwebtoken@9.0.2 | auth0/node-jsonwebtoken#1000 | jwt.sign(payload, key, { issuer }, cb) calls cb twice (error, then a token) when the payload already has iss (same for aud/sub/jti) |
| test | knex-5775 | knex@3.1.0 | knex/knex#5775 | knex 3.1.0 on the pg client drops .comment() from UPDATE/DELETE/INSERT statements (only SELECT keeps it) |
| test | knex-6074 | knex@3.1.0 | knex/knex#6074 | knex 3.1.0 silently drops .limit() from DELETE statements, so a 'batched' delete removes every matching row |
| test | knex-6163 | knex@3.1.0 | knex/knex#6163 | knex.raw(sql, {named}) treats a literal ? (Postgres jsonb key-exists operator) as a positional placeholder and shifts the bindings |
| dev | networkx-7758 | networkx@3.4.2 | networkx/networkx#7758 | categorical_multiedge_match compares the full set of parallel-edge attribute values, so MultiGraph subgraph monomorphism fails whenever the host has an extra parallel edge (e.g. two lines between a station pair) |
| test | numpy-27540 | numpy@2.1.2 | numpy/numpy#27540 | uint32_array /= IntEnum_member raises UFuncTypeError in numpy 2 (IntEnum is not treated as a weak Python int) |
| test | numpy-27580 | numpy@2.1.2 | numpy/numpy#27580 | masked uint8 array .min(axis=0) raises TypeError (int64 fill value cannot be cast to uint8) when anything is masked |
| test | numpy-27674 | numpy@2.1.2 | numpy/numpy#27674 | np.ptp(masked_array) ignores the mask in numpy 2 and returns nan/inf instead of the span of valid values |
| test | numpy-27679 | numpy@2.1.2 | numpy/numpy#27679 | masked uint16 frame += <python int> raises UFuncTypeError (int64 -> uint16 same_kind), plain ndarrays work |
| test | pandas-11953 | pandas@2.2.3 | pandas-dev/pandas#11953 | DataFrame.fillna('') silently leaves NaT in datetime64 columns |
| test | pandas-29576 | pandas@2.2.3 | pandas-dev/pandas#29576 | resample('2QS-MAR') ignores the startingMonth anchor and bins from the data start (Dec/Jun labels instead of Mar/Sep) |
| test | pandas-61223 | pandas@2.2.3 | pandas-dev/pandas#61223 | df.at[row, new_col] = [list] raises 'Must have equal len keys and value' (or stores garbage for a 1-element list) when the column doesn't exist |
| test | pandas-61568 | pandas@2.2.3 | pandas-dev/pandas#61568 | df.fillna(other_df) casts float columns to object/int64 when an all-NaN float column is filled from an object column |
| test | pandas-62072 | pandas@2.2.3 | pandas-dev/pandas#62072 | DataFrame.to_json() rounds floats (0.2617993877991494 -> 0.2617993878); even double_precision=15 does not round-trip |
| dev | plotly-4957 | plotly@5.24.1 | plotly/plotly.py#4957 | plotly.colors.validate_colors rejects valid CSS names/hsl() strings and accepts arbitrary strings inside a list (also mutates the list) |
| dev | pydantic-10570 | pydantic@2.9.2 | pydantic/pydantic#10570 | with use_enum_values=True, once a nested list[Model] field references the enum twice, a later direct enum field keeps the Enum member (model_dump -> <Currency.USD>, json.dumps fails) |
| dev | pydantic-10629 | pydantic@2.9.2 | pydantic/pydantic#10629 | an Enum with tuple values dumps to JSON as a list, and model_validate_json then rejects that list, so the model cannot round-trip through JSON |
| dev | pydantic-10694 | pydantic@2.9.2 | pydantic/pydantic#10694 | a `Parent / Child` union field dumps a Child instance as the bare Parent (subclass fields dropped) when the child holds an unvalidated int default on a float field |
| dev | pydantic-10891 | pydantic@2.9.2 | pydantic/pydantic#10891 | TypeAdapter(list[Model]).dump_json writes NaN/Infinity as null when the model's float field has a custom (PlainSerializer) serializer, ignoring the model's ser_json_inf_nan='constants' |
| test | pyyaml-868 | PyYAML@6.0.2 | yaml/pyyaml#868 | yaml.safe_load raises a bare ValueError (not yaml.YAMLError) for scalars such as `0x_`, `0b_` or an impossible date like 2024-02-30, so `except yaml.YAMLError` lets it escape |
| dev | requests-6917 | requests@2.32.3 | psf/requests#6917 | data=io.StringIO(non-ASCII text) sends a Content-Length counted in characters, not UTF-8 bytes, so the server receives a truncated body |
| dev | scikit-learn-30332 | scikit-learn@1.5.2 | scikit-learn/scikit-learn#30332 | NuSVC(class_weight=...) has no effect on the fitted model; sample_weight in fit() does |
| dev | scikit-learn-30935 | scikit-learn@1.5.2 | scikit-learn/scikit-learn#30935 | CountVectorizer's default token_pattern (?u)\b\w\w+\b shreds Hindi/Telugu words because combining marks are not \w |
| dev | scikit-learn-31350 | scikit-learn@1.5.2 | scikit-learn/scikit-learn#31350 | SimpleImputer(strategy='most_frequent').set_output(transform='pandas') returns object columns for pandas category input |
| test | seaborn-3641 | seaborn@0.13.2 | mwaskom/seaborn#3641 | seaborn.scatterplot(s=<array>, hue=...) raises TypeError while building the legend (s is forwarded to legend artists) |
| test | seaborn-3825 | seaborn@0.13.2 | mwaskom/seaborn#3825 | seaborn.pointplot(hue=..., dodge=True) raises ZeroDivisionError when the hue column has a single level |


## Reproduce

```sh
npm run build
npx tsx scripts/bench/validate.ts                      # fail→pass for every task
npx tsx scripts/bench/offline.ts --arm cards --split fresh-dev
env -u CLAUDE_CONFIG_DIR npx tsx scripts/bench/run.ts --arm none,rules,cards --split fresh-test --prompt terse --seeds 2
python3 scripts/bench/summarize.py bench/results/<run>.jsonl
```

Python tasks need the pinned environments from `bench/env/requirements*.txt`
(`bench/.venv`, `bench/.venv-fresh-a`, `bench/.venv-fresh-b`).
