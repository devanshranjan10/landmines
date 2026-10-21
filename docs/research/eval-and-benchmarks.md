# landmine: what "SOTA" can honestly mean, and how to evaluate it

Research date: 2026-10-21. Read-only research; nothing installed or posted. GitHub mining artifacts
(raw search JSON, (file, issue) TSVs, issue states/labels) are in `/tmp/landmine-mining/`.
Helper scripts are in `/tmp/landmine-scripts/`.

---

## 0. TL;DR

- **There is no public benchmark for what landmine does.** That task is: given downstream code plus a lockfile, find the open
  upstream issue whose triggering condition this edit meets, and interrupt the agent. Every benchmark I found measures a
  neighbour:
  - version-specific API knowledge (GitChameleon 2.0, VersiCode, CodeUpdateArena, LibEvolutionEval, CodeSyncBench,
    the ICSE'25 deprecated-API study);
  - issue-to-code localization inside the same repo (SWE-bench Lite / LocBench / MULocBench);
  - issue-to-issue duplicate detection;
  - issue-to-commit linking.

  None has a downstream-code → upstream-issue label. So no leaderboard exists to be "SOTA" on.
- **What can honestly be claimed:**
  1. "First benchmark for known-upstream-bug avoidance by coding agents", if you build and publish one. Then "best on it
     versus named baselines": no tool, GitHub MCP `search_issues`, a passive `KNOWN_ISSUES.md`/AGENTS.md, embedding
     retrieval, and an LLM judge.
  2. Per-layer precision and recall with confidence intervals, measured against baselines on the same data.

  Claiming SOTA on GitChameleon or similar would be a category error. Those tasks are about API changes between
  versions, not open bugs, and landmine indexes open bugs.
- **Mining recall ground truth is feasible.**
  - 26 search-API calls (17 code search, 9 commit search) produced 1,291 raw (file, upstream-issue-URL) pairs from 1,200
    code-search results across 9 popular npm/PyPI packages.
  - 97–100% of returned files contain the exact URL.
  - After dedup by (repo owner, issue) and keeping only bug-labelled issues: **535 pairs**. 124 of those point to bugs
    that are still open, 80 of them from drizzle-orm alone.
  - A few hundred labelled (file, issue) pairs is realistic within a day of scripting.
- **The pairs mostly reference closed issues and versions the issue does not name.** So the recall eval must be
  "time-travel": rebuild the index as of the commit date and the lockfile at that commit.
  - I spot-checked 3 drizzle cases. In all three the downstream repo pinned a different version than the one the issue
    names (1.0.0-beta.22 vs 0.45.1; 0.44.4 vs 0.39.3; ^0.29.3 vs 0.26.5).
  - landmine's exact-version rule would miss all three.
  - This is likely to be the single most important recall finding. Measure it at scale before tuning anything else.

---

## 1. What "SOTA" can honestly mean here

| Claim | Honest? | Why |
|---|---|---|
| "SOTA on GitChameleon / VersiCode / CodeUpdateArena" | **No** (wrong task) | These grade whether generated code matches a *given version's API*. They are mostly about breaking changes and new features, not open bugs. landmine's index (open issues naming the exact version) would rarely, if ever, fire on these tasks. At best this is a no-regression check. |
| "SOTA on SWE-bench / LocBench localization" | **No** | Issue → files in the *same* repo. landmine runs the other way and across repos (downstream code → upstream issue). |
| "SOTA duplicate-bug detection" | **No** | Issue ↔ issue. landmine's query is code, not a bug report. |
| "First public benchmark of known-upstream-bug avoidance; landmine beats baselines X, Y, Z on it" | **Yes, if built properly** | Requirements: a held-out split, a frozen protocol, baselines run by you on the same data, CIs, and released data. This is how CodeUpdateArena, GitChameleon, ImpossibleBench and IssueTrojanBench each established "their" leaderboard. |
| "Precision P [CI], recall R [CI] for surfacing the right upstream issue, versus GitHub-MCP-search and embedding baselines" | **Yes** | A per-layer measurement against explicit baselines. |
| "Agents with landmine avoid N% more known bugs than agents with GitHub MCP or a static AGENTS.md" | **Yes, if the e2e eval is run** | This is the claim that matters for the product (§5.3). |

The bar to clear is your own baselines, especially two cheap ones:

- **A static, passive context file.** Vercel found an 8 KB AGENTS.md docs index reached 100% on their Next.js 16 evals.
  The no-docs baseline was 53%. A docs *skill* also scored 53% by default (79% when told to use it) because it went
  uninvoked in 56% of cases.
  ([Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals))

  If `landmine scan` wrote a `KNOWN_ISSUES.md` and that matched the hook, the hook would not be justified.
- **GitHub MCP `search_issues`.** This is the "agent pulls when it thinks to" baseline.

---

## 2. Existing benchmarks and datasets

### 2a. Do agents avoid known library bugs or upstream issues?

**I found nothing that measures this directly.**
- Searches for benchmarks on upstream bugs, downstream workarounds, or "known issue" avoidance returned only adjacent
  work.
- Deep-Bench ([arXiv 2502.18726](https://arxiv.org/pdf/2502.18726)) has an "incorrect library usage" category, which is
  about the model's mistakes, not library bugs.
- DS-1000 tests library *usage*.
- The closest research thread is **"on-hold" self-admitted technical debt**: code comments that wait on an upstream
  issue.
  - Maipradit et al. define it and built a classifier (regex + ML, AUC 0.98) that separates on-hold issue references in
    comments from plain cross-references. It also mines whether the referenced issue has since closed.
  - Sources: [EMSE 2020 / arXiv 1901.09511](https://arxiv.org/abs/1901.09511),
    [arXiv 2009.13113](https://arxiv.org/abs/2009.13113).
  - Hata et al. studied **9.6M links in code comments** across 25,925 repos: about 10% are dead, and links are rarely
    updated. ([ICSE 2019, arXiv 1901.07440](https://arxiv.org/pdf/1901.07440))

  These two are the methodological foundation for the mining approach in §6, and should be cited.

### 2b. Version-specific API knowledge

| Benchmark | Measures | Size | License | Adaptable to landmine? | Best reported |
|---|---|---|---|---|---|
| **GitChameleon 2.0** ([arXiv 2507.12367](https://arxiv.org/abs/2507.12367), [repo](https://github.com/mrcabbage972/GitChameleonBenchmark), NeurIPS 2025) | Whether version-conditioned code passes hidden unit tests. Covers LLMs, agents, RAG and coding assistants (Claude Code, Cline, Goose). | 328 problems, 26 Python libs | Apache-2.0 (repo) | **Methodology only.** It has an execution-verified, version-pinned task format and a coding-assistant harness. The tasks are about breaking changes, not open bugs, so it works as a no-regression or false-interrupt check (landmine should stay silent). | Greedy decoding: o1 at 51.2%. RAG k=3: Claude 4 Sonnet at 59.4%. Coding assistants: Goose + GPT-4.1 at about 55.5%; Claude Code + Claude 3.7 Sonnet at 48.8%. (Paper figures; extracted text partly garbled.) |
| **VersiCode** ([arXiv 2406.07411](https://arxiv.org/abs/2406.07411), [repo](https://github.com/wutong8023/VersiCode)) | Version-specific completion and version-aware migration (CDC@1 metric). | About 300 libs, 2,000+ versions, 9 years | README badge says MIT; GitHub API reports Apache-2.0 (conflict) | Low. Static matching, no open-bug notion. | Authors report that GPT-4o and frontier models struggle. I did not extract exact numbers. |
| **CodeUpdateArena** ([arXiv 2407.06249](https://arxiv.org/abs/2407.06249), [repo](https://github.com/leo-liuzy/CodeUpdateArena)) | Whether a model uses a *synthetic* API update (UPass/SPass). | 670 program-synthesis tasks, 7 packages | MIT | Low. The updates are synthetic, though the "inject update text into context" condition resembles landmine's message. | Prepending the update helps. Fine-tuning on docs alone barely helps. |
| **LibEvolutionEval** ([arXiv 2412.04478](https://arxiv.org/abs/2412.04478), [repo](https://github.com/amazon-science/LibEvolutionEval), NAACL 2025) | Version-specific completion over years. Has both realistic and controlled sets. | 8 libs (torch, torchvision, scipy, PIL, tqdm, pyyaml, matplotlib, pandas) | NOASSERTION | Low | Version-matched docs retrieval helps. Exact numbers are in the paper. |
| **Deprecated-API usage in LLM completion** ([arXiv 2406.09834](https://arxiv.org/abs/2406.09834), ICSE 2025) | Rate at which LLM completions use deprecated APIs. | 145 API mappings, 8 libs, 28,125 prompts, 7 LLMs | Research artifact | Medium as a *method*: inject the guidance, then measure the usage rate. | 25–38% deprecated usage. Their ReplaceAPI fix reaches >85% fix rate; InsertPrompt was ineffective. |
| **CodeSyncBench** ([ICML 2025](https://proceedings.mlr.press/v267/wang25t.html)) | Completion, error correction and multiple-choice on real API updates. | 3,300 cases, 220 APIs, 6 libs | See paper | Low | All 14 LLMs struggle, even with DPO, ORPO or SimPO. |

### 2c. Retrieving relevant issues for code or traces (localization, dedup, linking)

| Benchmark / line | Measures | Size | License | Adaptable? | Best reported (author-reported, not comparable across papers) |
|---|---|---|---|---|---|
| **SWE-bench Lite as localization** ([LocAgent arXiv 2503.09089](https://arxiv.org/pdf/2503.09089)) | Issue → gold patched files/functions, same repo | 300 issues | MIT (SWE-bench) | Reverse direction from landmine. Useful only as a component test for a code↔issue embedder. | File Acc@1: LocAgent + Claude 3.5 at 77.7%. SweRank-LLM 32B reports file Acc@5 of 94.2% ([arXiv 2505.07849](https://arxiv.org/pdf/2505.07849)). FastCode reports Acc@1 of 86.1% ([arXiv 2603.01012](https://arxiv.org/pdf/2603.01012)). Function-level top-10 is about 60% on LocBench. |
| **LocBench** ([repo](https://github.com/gersteinlab/LocAgent)) | Same task, more diverse issue types, less contamination | 560 issues | Apache-2.0 | Same as above | SweRank claims SOTA |
| **MULocBench** | Localization including non-code files | 1,100 issues, 46 projects | See paper | Same as above | n/a |
| **SweRank / SweRank+** ([arXiv 2505.07849](https://arxiv.org/abs/2505.07849), [2512.20482](https://arxiv.org/pdf/2512.20482)) | Retriever (bi-encoder) + listwise LLM reranker | n/a | NOASSERTION | **The small retriever is a candidate code↔issue model.** SweRankEmbed-Small has 137M parameters. | On SWE-bench Multilingual, Acc@10: Small 44.0%, Large (7B) 50.9%, Small + LLM rerank 56.8%. |
| **Duplicate bug report detection** ([Zhang et al., TOSEM 2023, arXiv 2212.00548](https://arxiv.org/pdf/2212.00548)) | Issue ↔ issue ranking (RR@k) on Bugzilla, Jira and GitHub (VSCode, Kibana) | 6 projects | See paper | For the *index* only: grouping duplicate upstream issues | REP (2011) beats deep models on 5 of 6 projects. Plain full-text search is competitive (REP beats it by 22–63% RR@10). Recent data is harder (age bias). |
| **CUPID** (ChatGPT + REP, [arXiv 2308.10022](https://arxiv.org/abs/2308.10022)) | Dedup with an LLM in the loop | 3 datasets | See paper | Same as above | RR@10 of 0.602–0.654 (versions differ) |
| **Issue–commit link recovery** ([Hybrid-Linker arXiv 2107.01894](https://arxiv.org/pdf/2107.01894), [EALink arXiv 2308.10759](https://arxiv.org/pdf/2308.10759), [EasyLink arXiv 2507.09199](https://arxiv.org/pdf/2507.09199)) | Does commit C address issue I (binary) | 12–20 projects | See papers | **The closest published *binary* code↔issue relevance task.** Precision and recall are reported. | Hybrid-Linker: P 87.8%, R 90.1%, F1 88.9% (balanced, same-repo, easy negatives). Re-evaluated on a harder setup: ReLink 10.8% F1 vs EasyLink 58.8% F1. The setup changes the result by roughly 5x. |
| **CodeRAG-Bench** ([arXiv 2406.14497](https://arxiv.org/abs/2406.14497), [repo](https://github.com/code-rag-bench/code-rag-bench)) | Retrieval-augmented codegen with docs, StackOverflow and GitHub as sources | 8 tasks | No license file | Methodology for "does retrieved context help". The finding that retrievers fail when lexical overlap is low applies to landmine. | n/a |

### 2d. Agent trap and pitfall tasks (methodology donors)

- **ImpossibleBench** ([arXiv 2510.20270](https://arxiv.org/abs/2510.20270), ICLR 2026) creates impossible variants of
  LiveCodeBench and SWE-bench tasks (spec conflicts with the tests). It measures the "cheating rate". The useful idea is
  to *construct* tasks with a known trap and score whether the agent falls in.
- **IssueTrojanBench** ([arXiv 2607.20759](https://arxiv.org/html/2607.20759v1)) reports that 66.5% of malicious
  issues get past every agent- and LLM-level guardrail. This is directly relevant because landmine quotes untrusted
  issue comments into the agent's context. Include an injection-robustness slice.
- **SWT-bench** ([NeurIPS 2024](https://neurips.cc/media/neurips-2024/Slides/96304.pdf)) and
  **LIBRO** ([arXiv 2209.11515](https://arxiv.org/pdf/2209.11515)) turn an issue into a fail-to-pass reproduction test.
  LIBRO reproduces 33% (251/750) of Defects4J bugs. Use the F→P validation rule for trap tasks.
- **Overeager Coding Agents** ([arXiv 2605.18583](https://arxiv.org/pdf/2605.18583)) measures out-of-scope actions on
  benign tasks. Its control-task idea maps onto landmine's false interrupts.
- **"Do Context Files Help Coding Agents?"** ([arXiv 2607.27250](https://arxiv.org/abs/2607.27250)) ran 288 runs over
  17 tasks with Claude Code and Codex, using gold tests and equivalence testing (effects bounded to ≤10–15 pp). It found
  no measurable effect. This is the template for a properly powered with/without study, and a warning that small n
  proves nothing.
- **Vercel AGENTS.md vs skills eval**
  ([blog](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)) targets APIs absent from training
  data and compares no docs, a skill, a skill with instructions, and AGENTS.md. **This is the closest e2e design to what
  landmine needs.**

---

## 3. Prior art tools (adjacent; no published accuracy numbers found)

| Tool | What it does | Overlap | Accuracy published? |
|---|---|---|---|
| [shoulders](https://github.com/mjswensen/shoulders) (62★, MIT, dormant since 2022) | Lists open issues of every dependency in node_modules | Not version- or code-aware | No |
| [errorscape](https://www.npmjs.com/package/errorscape) (2024) | Issue links per dependency, plus stack-trace search | Thin README, placeholder output | No |
| depscope-mcp `get_known_bugs` ([listing](https://policylayer.com/tools/dev-depscope-mcp/get-known-bugs.md), [repo](https://github.com/cuttalo/depscope-mcp)) | MCP tool returning "non-CVE known bugs for a package version" with `fixed_in` and `workaround` | **The closest in spirit.** The service is now **retired** ([depscope.dev](https://depscope.dev) says the API and MCP are offline). | No |
| depoverflow ([PyPI](https://pypi.org/project/depoverflow/0.1.0)) | Watches StackOverflow answers and GitHub issues *referenced in code comments* for changes | Uses the same signal as §6, in the inverse direction | No |
| [canidelete](https://github.com/Telle-dev/canidelete) | Inverse of landmine: finds your workaround comments whose upstream issue has closed | Same signal as §6 | No |
| [GitHub MCP server](https://github.com/github/github-mcp-server) | `search_issues` / `issue_read` on demand | The pull baseline for the e2e eval | No |
| Context7 (Upstash) | Version-specific docs and snippets | Docs, not bugs | No controlled ablation found. Only anecdotes, and a vendor-run comparison by Mintlify ([kapa](https://www.kapa.ai/library/best-mcp-server-for-giving-coding-agents-access-to-documentation), [mintlify](https://www.mintlify.com/library/best-mcp-servers-for-coding-agents)) |
| Socket reachability ([docs](https://docs.socket.dev/docs/reachability-analysis)) | Is the vulnerable function reachable (CVE only) | The code-condition analog for vulnerabilities | Vendor claim only: ">80% false positives eliminated" (up to 90% at Tier 1). Socket returns "unknown" rather than guessing. |
| Snyk reachability ([docs](https://docs.snyk.io/manage-risk/prioritize-issues-for-fixing/reachability)) | Static analysis + AI, CVE only | Same as above | No numbers. Docs state that it under-approximates, favouring precision. |
| Renovate Merge Confidence ([docs](https://docs.renovatebot.com/merge-confidence/)) | Crowd signals (age, adoption, % tests passing) to flag undeclared breaking releases | Upgrade risk, not open-bug matching | No accuracy figures |
| Dependabot compatibility score ([GitHub docs](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates)) | % of CI runs passing for a version bump across public repos | Same as above | No |
| Sourcegraph / DeepWiki | Code search and repo wikis | No dependency-bug feature found | No |

Already covered in `landmine/docs/RESEARCH.md`: helpstack, Evergreen, npm-issues, Kindly Web Search MCP and Agent.md.

---

## 4. Methods for deciding "does this edit meet the bug's triggering condition"

| Method | Reported precision / recall in nearest literature | Cost / latency | Fit for landmine |
|---|---|---|---|
| **Symbol-only matching** (landmine v0) | Your own data: about 7–10% of matches relevant (C1: 3 of 28). Compare static API-misuse detectors on MUBench: **best precision 11.4%, all below 12%, recall low** ([Amann et al., arXiv 1712.00242](https://arxiv.org/pdf/1712.00242)). | ~ms, offline | This is the floor. The literature agrees that "deviation or name match ≠ misuse". |
| **Corroboration (second issue-specific symbol)** (current) | Your C3 held-out data: 1 block in 60 files, and it was a near miss | ~ms, offline | Gives high precision only by giving up most firings. Recall unknown, so measure it (§6). |
| **Embedding retrieval code↔issue** | SweRankEmbed-Small (137M) Acc@10 of 44% on SWE-bench Multilingual. Retrievers fail at low lexical overlap ([CodeRAG-Bench](https://arxiv.org/abs/2406.14497)). | Small model, CPU-feasible, but I found no published latency figure for this use | Good for *candidate generation*, not for deciding to block. |
| **Cross-encoder reranker** | No code↔issue numbers found. bge-reranker-v2-m3 took 3.05 s/query on an A100 in a 100-candidate rerank benchmark ([mixedbread](https://mixedbread.com/blog/mxbai-rerank-v2)). Jina reranker v2 claims 15x bge throughput but its weights are CC-BY-NC. Qwen3-Reranker-0.6B is Apache-2.0. | Too slow and heavy for a 0.09 s pre-edit hook unless it runs only on a handful of candidates | Use offline in scan or eval, not in the hook. |
| **LLM-as-judge (binary "does this snippet meet the condition in this issue")** | IR relevance judging (UMBRELA): binary κ of about 0.4–0.5 with TREC assessors; LLMs are more lenient than humans ([arXiv 2406.06519](https://arxiv.org/pdf/2406.06519), [2504.12558](https://arxiv.org/html/2504.12558v1)). LLM false-positive filtering on static bug reports (LLM4PFA) removed 72–96% of FPs while missing 3 of 45 TPs ([arXiv 2506.10322](https://arxiv.org/pdf/2506.10322)). | `claude-haiku-5-5`: $0.10 / $0.50 per MTok in, out (≤100K prompt). Batch API is 50% off. About 3K tokens in and 100 out is roughly $0.00035 per judgment (my arithmetic). I found no documented latency figure; it adds a network call and breaks the "offline hook" property. | **Best as an offline adjudicator**, either in scan or on the rare corroborated candidates, and as the scalable labeller in eval (calibrated against 2 human raters, report κ). |
| **Static condition extraction (per-issue rule synthesized offline, checked offline at hook time)** | Closest analog: **QLCoder** synthesizes CodeQL queries from CVE metadata. 53.4% of 176 CVEs got a query that fires on the vulnerable version and not the patched one, versus 10% for plain Claude Code ([arXiv 2511.08462](https://arxiv.org/abs/2511.08462)). | LLM cost at scan time only; the hook stays ~ms and offline | **Recommended direction.** At scan time, have an LLM emit a structured trigger (API + required option/arg/driver/env + version). Self-validate it: it must match the issue's own repro snippet and must *not* match the quoted workaround. Drop rules that fail. Precision gains come from the rule; recall loss is measurable per stage. |
| **Executable reproduction** | SWT-bench / LIBRO: issue→repro test success is roughly 33–66% depending on system | Expensive (installs per version) | Use for eval ground truth on a subset, not at runtime. |

---

## 5. Recommended evaluation design

General rules for all layers:
- Freeze a held-out package set before tuning.
- Use two independent raters on a ≥20% overlap and report Cohen's κ.
- Report Wilson 95% CIs.
- Release the labels.
- Pre-register metrics.
- Say what is in-sample.

### 5.1 Layer (i): index quality (per-issue labels)

- **Unit:** an armed (package@version, issue) entry.
- **Labels:**
  - version-correct (reporter or confirmer ran exactly that version);
  - is-bug (not feature or docs);
  - still-open-and-unfixed in that version;
  - top-1 and top-3 armed symbol is the bug's API;
  - workaround genuine.
- **Size:** about 200 entries per ecosystem (n=200 at p≈0.8 gives about ±5.5 pp). Stratify by package so drizzle-heavy
  sets don't dominate.
- **Raters:** two blind raters, with an LLM judge as a third rater. Report LLM↔human κ so the LLM can label future sets.
- **Executable spot-check:** on about 20 issues, install the pinned version and run the issue's repro, GitChameleon/SWT
  style.
- **Recall at index level (new):** use the §6 mined set. For each mined bug, was the issue in the index for that
  package@version as of the commit date? Report it as a funnel:
  1. dependency is direct and exact-pinned;
  2. issue retrieved by version search;
  3. issue states that version;
  4. classified as a bug;
  5. symbol armed.

  The first 3 drizzle spot-checks already fail at stage 3 (version named ≠ version pinned).

### 5.2 Layer (ii): match relevance on real code (precision **and** recall)

**Precision set:**
- Use the existing C1–C3 approach, which is random files importing the package.
- Add *realistic edit units*: replay real commit diffs from those repos as "edits" instead of whole files. The
  current whole-file mode is the worst case.
- Metrics:
  - precision of block;
  - precision of heads-up;
  - **false interrupts per 1,000 edits**, which is the number users feel.

**Recall set (mined ground truth, §6):**
- **Positive unit:** (repo@commit, file, upstream issue N), where a developer wrote a comment linking N next to code
  that uses the affected API, and the repo's lockfile at that commit pins the package.
- **Build each case:**
  1. Find the *introducing* commit with `git log -S "issues/N" -- file`. Blame gives the last touch: oslo.db's blame
     commit was "Add link to bug", not the workaround.
  2. Take the lockfile at that commit.
  3. Take the issue state as of that date (created before, not closed before). Version statements must come from the
     body and comments dated before the commit.
  4. Take the **counterfactual pre-workaround code**. Use the diff's removed lines if the workaround replaced naive code.
     Otherwise, have an LLM strip the workaround and a human verify it. In remorses/playwriter the file was born with
     the workaround, so no "before" exists.
- **Recall metric:**
  - Fraction of positives where landmine, with its index rebuilt as of that date, would surface N:
    - on editing the counterfactual code (block or heads-up);
    - on editing the actual code (it should ideally say "already handled", or stay quiet).
  - Report this per stage of the funnel, and separately for exact-version and "issue names an older version, bug
    still open" cases. The second case quantifies what a range-aware index would gain.
- **Baselines on the same set:**
  1. GitHub `search/issues` with an agent-style query (package + symbol + error text);
  2. BM25 over the package's open issues;
  3. an embedding retriever (SweRankEmbed-Small or Qwen3-Embedding);
  4. an LLM judge over the top-k.

  Report P/R/F1 and recall@k.

### 5.3 Layer (iii): end-to-end agent trap tasks

**Task construction:**
- For each selected *open* bug, build a mini-project, like `examples/demo`:
  - lockfile pinned to the affected version;
  - a natural prompt whose most likely solution hits the bug (no mention of bugs);
  - a hidden test validated F→P. The naive solution must fail it and the issue's workaround must pass it, as in
    SWT-bench.
- Prefer bugs **filed after the agent model's training cutoff** to avoid memorized workarounds, as LiveCodeBench
  does.
- Seed tasks from the §6 mined set: real developers hit these bugs, which gives ecological validity.

**Control tasks:**
- The same packages and APIs, but the bug's condition is *not* met. Measures harm: false interrupts, wasted turns,
  worse code.
- Add an injection slice: a workaround comment carrying a prompt-injection payload, following IssueTrojanBench.

**Arms:**
- (A) no tool;
- (B) landmine hook (block mode);
- (C) landmine `--heads-up` / warn;
- (D) landmine MCP only (pull);
- (E) GitHub MCP server with `search_issues`;
- (F) **static `KNOWN_ISSUES.md` generated by `landmine scan` in AGENTS.md/CLAUDE.md**. Vercel's result says this
  passive baseline is the most dangerous competitor.

**Agents:** Claude Code and Codex at minimum, matching the existing e2e demos.

**Metrics:**
- bug-avoidance rate (hidden trap test passes);
- functional task success;
- interrupts per task;
- added turns, tokens and wall time;
- false-interrupt rate on controls;
- the rate at which the agent cites the issue.

**Statistics:**
- Paired by task. Use McNemar or a mixed-effects logistic regression with task as a random effect, and ≥3 seeds per
  (task, arm).
- Rough power, per arm, for α=0.05 and power 0.8:
  - a 70% → 20% bug-hit difference needs about 12 tasks;
  - a 50% → 35% difference needs about 170 tasks.
- So plan 40–60 trap tasks plus 40 controls. Run a 10-task pilot first to estimate effect size and per-run cost.
- **Report equivalence bounds when the effect is null**, as in arXiv 2607.27250.

**Similar methodology to cite:**
- GitChameleon 2.0's coding-assistant harness;
- the Vercel AGENTS.md vs skills eval;
- "Do Context Files Help Coding Agents?";
- ImpossibleBench (trap construction);
- SWT-bench (F→P validation);
- IssueTrojanBench (injection).

### 5.4 What to publish as the "SOTA" claim

Name it "landmine-bench v0":
- layer (ii) recall/precision set (mined, time-travel);
- layer (iii) trap and control tasks;
- frozen splits;
- all baselines;
- harness.

The headline claim is: "On landmine-bench, the landmine hook avoids X% [CI] of known bugs versus Y% for GitHub-MCP and
Z% for a static KNOWN_ISSUES.md, with W false interrupts per 1,000 edits." That is a defensible "state of the art"
for a task you define, and it is the only honest form available.

---

## 6. Feasibility of mining recall ground truth (done, read-only, 26 search calls)

### 6.1 Method

**Code search:**
- `gh api search/code -H 'Accept: application/vnd.github.text-match+json' -f q='"github.com/<owner>/<repo>/issues/" language:<Lang>'`,
  100 results per page.
- The issue URL is extracted from `text_matches[].fragment` with a regex.
- Issue state and labels come in batches via GraphQL `issueOrPullRequest(number:)`.
- Lockfile versions at the commit come from contents/GraphQL blame.

**Constraints:**
- Code search is limited to 10 requests/min and caps at 1,000 results per query. Go beyond that by slicing on
  `path:`, `extension:`, `size:` or language.
- I hit both the primary and the secondary rate limit once.
- **`total_count` is meaningless for exact URLs.** The legacy API tokenizes the phrase: pandas reported 1,654,784 and
  pydantic 122,880. Only the returned items, which are 97–100% exact, can be trusted.

### 6.2 Code search results (best-match first 100 results per query; drizzle paged to 400)

| Package (query) | Results scanned | Files with exact URL | Raw pairs | Distinct issues | Dedup (owner, issue) | Bug-labelled (dedup) | **Still-open bug (dedup)** |
|---|---|---|---|---|---|---|---|
| drizzle-orm (`language:TypeScript`) | 400 of ~611 | 394 | 443 (279 repos) | 235 | 384 | 275 | **80** |
| pydantic (`language:Python`) | 100 | 98 | 118 | 86 | 112 | 55 | 13 |
| prisma (`language:TypeScript`) | 100 | 100 | 105 | 66 | 97 | 46 | 18 |
| next.js (`language:TypeScript`) | 100 | 97 | 102 | 75 | 91 | 33 | 4 |
| sqlalchemy (`language:Python`) | 100 | 100 | 105 | 70 | 95 | 35 | 5 |
| pandas (`language:Python`) | 100 | 99 | 108 | 83 | 103 | 41 | 4 |
| zod (`language:TypeScript`) | 100 | 99 | 107 | 73 | 98 | 0* | 0* |
| langchain (`language:Python`) | 100 | 93 | 102 | 71 | 92 | 36 | 0 |
| fastapi (`language:Python`) | 100 | 100 | 101 | 66 | 93 | 14 | 0 |
| **Total** | **1,200** | | **1,291** | | | **535** | **124** |

\*zod does not use bug labels, so this is a labelling artifact. langchain and fastapi have mass-closed or converted
their issues, which is why they show 0 open.

Bug-like means a label matching bug/regression/crash, or a `[BUG]` title. The "workaround" variant of the pydantic
query (q7) returned 100 results, 98 exact, covering 45 issues.

### 6.3 Commit search

| Query | total_count | Notes |
|---|---|---|
| `"workaround for https://github.com"` | 40,663 | All upstreams. Commit messages and diffs carry the date and before/after code. |
| `"pydantic/pydantic/issues"` | 3,207 | **56 of the first 100 are bot-authored** (Renovate/Dependabot release-note bumps), so filter by author. |
| `"pydantic/pydantic/issues" workaround` | 465 | e.g. vllm-project/guidellm c47a1f6 "Add workaround for …/pydantic/issues/9541" |
| `"prisma/prisma/issues" workaround` | 61 | |
| `"drizzle-team/drizzle-orm/issues" workaround` | 7 | e.g. bnussman/beep 55a3209 "chore(ci): workaround …/drizzle-orm/issues/5653" |

Three more commit queries (next.js, sqlalchemy, pandas) hit the secondary rate limit and were not retried.

### 6.4 Concrete examples

Each row shows the code comment's issue reference, the issue state today, and what landmine would do.

| # | Repo / file (blame commit, date) | Referenced issue | State, type | Pinned at commit vs version in issue | Note |
|---|---|---|---|---|---|
| 1 | remorses/playwriter `db/src/node.ts:62` (ba1e353, 2026-06-22) | [drizzle-orm#5461](https://github.com/drizzle-team/drizzle-orm/issues/5461) sqlite-proxy `get` no-row returns `{id: undefined}` | **OPEN**, bug | `1.0.0-beta.22` vs issue `0.45.1` | Exact-version **miss**. The file was born with the workaround, so there is no "before" code. The same comment appears in 3 more repos by the same author (holocron, zele, sigillo), so dedup is needed. |
| 2 | dmilin1/hydra `db/index.ts:17` (060160e, 2026-02-22) | [drizzle-orm#4519](https://github.com/drizzle-team/drizzle-orm/issues/4519) expo-sqlite statements never finalized | **OPEN**, bug | lock `0.44.4` vs issue `0.39.3`. None of the 4 comments mention 0.44. | Exact-version **miss** |
| 3 | openint-bak/byos `packages/worker/functions.ts:249` (863f3d3, 2024-05-03) | [drizzle-orm#724](https://github.com/drizzle-team/drizzle-orm/issues/724) jsonb inserted as string with postgres-js | CLOSED 2024-08-08 (open at commit time), bug | `^0.29.3` vs issue `0.26.5` | Needs time travel. Exact-version **miss**. |
| 4 | stalniy/casl `packages/casl-prisma/src/createCaslExtension.ts:5` (ee850e8, 2026-05-04) | [prisma#17367](https://github.com/prisma/prisma/issues/17367) `{ OR: [] }` ignored with other conditions | **OPEN**, bug/2-confirmed | Library, so a range and no lockfile | Excluded unless lockfile-based |
| 5 | openstack/oslo.db `oslo_db/sqlalchemy/exc_filters.py:454` (6c780a4, 2023-07-20) | [sqlalchemy#10116](https://github.com/sqlalchemy/sqlalchemy/issues/10116) re-entrant handle_error | **OPEN**, bug | `SQLAlchemy>=1.4.0` | The blame commit is "Add link to bug", so `git log -S` is needed to find the real workaround commit |
| 6 | feeluown/FeelUOwn `feeluown/library/models.py:241` (26e3cfe, 2025-05-05) | [pydantic#11505](https://github.com/pydantic/pydantic/issues/11505) pydantic-core 2.29.0 wrapped-serializer bug | CLOSED 2025-03-04, bug V2 | `pydantic>=1.10` | A sharply version-specific bug. Exactly what landmine targets, but invisible to it after the close. |
| 7 | JayLZhou/GraphRAG `Core/Common/ContextMixin.py:16` (aff45a3, 2024-11-11) | [pydantic#7142](https://github.com/pydantic/pydantic/issues/7142) `model_validator(mode="after")` self lacks PrivateAttr | **OPEN**, bug V2 | No pin found in requirements.txt | The same snippet appears in bingreeky/MaAS (copied code) |
| 8 | radis/radis `radis/misc/basics.py:383` (1771df1, 2021-08-05) | [pandas#28283](https://github.com/pandas-dev/pandas/issues/28283) methods don't call `__finalize__` | **OPEN** since 2019, Bug | Not checked | A long-lived open bug, so a version-agnostic match is valid |
| 9 | i-am-bee/agentstack `apps/beeai-web/next.config.ts:89` (c9a24f8, 2025-03-10) | [next.js#64921](https://github.com/vercel/next.js/issues/64921) inconsistent CSS order in App Router | **OPEN**, no bug label | Not checked | Shows that label-based bug filtering loses real bugs |
| 10 | zoriya/Kyoo `api/src/db/utils.ts`, mprove-io/mprove, icssc/anteater-api, pradel/stackspulse | [drizzle-orm#1728](https://github.com/drizzle-team/drizzle-orm/issues/1728) `onConflictDoUpdate()` set many | **OPEN**, `[FEATURE]` | n/a | Feature-request shims are a common noise class: 40 of 234 drizzle refs are `[FEATURE]` |

### 6.5 Verdict and pitfalls

**Feasible.** 535 owner-deduped bug-labelled pairs came from about 26 queries over 9 packages. Extending to
about 30 packages and paging each query to 1,000 should give 1,000–3,000 candidate pairs.

**Pitfalls to budget for:**
1. Most referenced issues are now **closed**: drizzle 59%, pandas 92%, fastapi and langchain 100%. Time-travel
   reconstruction is mandatory, and landmine as shipped (open issues only) ignores them.
2. **Library repos declare ranges**, not pins. Keep only repos with a lockfile at the commit (package-lock, pnpm-lock,
   yarn.lock, uv.lock, poetry.lock).
3. **Version mismatch.** In 3 of 3 checked cases the pin ≠ the version named in the issue. This directly bounds
   exact-version recall. Measure it at scale first.
4. **Blame ≠ introduction**, so use `git log -S`.
5. **The commented code is the workaround.** Positives need the pre-workaround diff or a verified counterfactual.
6. **Copies:** agent-skill templates (e.g. `skills/…/drizzle-orm-d1/templates/transactions.ts` in 3+ repos), forks,
   vendored libraries, and the same author across repos. Dedup by (owner, issue) and by content hash.
7. **Feature, docs and tutorial references.** Filter by label or title, and keep a human pass, since next.js#64921 is a
   real bug without a bug label.
8. **Bot commits** in commit search.

**Recommended pipeline:**
1. code search → pairs;
2. GraphQL issue type, labels and timeline;
3. `git log -S` introducing commit + lockfile at that commit (keep exact pins);
4. the issue as of that date (body and comments before the commit);
5. counterfactual code;
6. human or LLM label "the code at the call site meets the issue's condition";
7. freeze a held-out split by upstream package.

---

## 7. Sources

**Benchmarks:**
- [GitChameleon 2.0](https://arxiv.org/abs/2507.12367) · [repo](https://github.com/mrcabbage972/GitChameleonBenchmark) · [NeurIPS page](https://neurips.cc/virtual/2025/131646)
- [VersiCode](https://arxiv.org/abs/2406.07411) · [repo](https://github.com/wutong8023/VersiCode)
- [CodeUpdateArena](https://arxiv.org/abs/2407.06249) · [repo](https://github.com/leo-liuzy/CodeUpdateArena)
- [LibEvolutionEval](https://arxiv.org/abs/2412.04478) · [repo](https://github.com/amazon-science/LibEvolutionEval)
- [Deprecated API usage (ICSE'25)](https://arxiv.org/abs/2406.09834)
- [CodeSync](https://proceedings.mlr.press/v267/wang25t.html)
- [LocAgent / LocBench](https://arxiv.org/pdf/2503.09089) · [SweRank](https://arxiv.org/abs/2505.07849) · [SweRank+](https://arxiv.org/pdf/2512.20482) · [FastCode](https://arxiv.org/pdf/2603.01012) · [SWE-Debate](https://arxiv.org/pdf/2507.23348)
- [DBRD: How far are we](https://arxiv.org/pdf/2212.00548) · [CUPID](https://arxiv.org/abs/2308.10022)
- [Hybrid-Linker](https://arxiv.org/pdf/2107.01894) · [EALink](https://arxiv.org/pdf/2308.10759) · [EasyLink](https://arxiv.org/pdf/2507.09199)
- [CodeRAG-Bench](https://arxiv.org/abs/2406.14497)
- [Deep-Bench](https://arxiv.org/pdf/2502.18726)

**Pitfall and agent methodology:**
- [ImpossibleBench](https://arxiv.org/abs/2510.20270)
- [IssueTrojanBench](https://arxiv.org/html/2607.20759v1)
- [Overeager Coding Agents](https://arxiv.org/pdf/2605.18583)
- [SWT-bench](https://neurips.cc/media/neurips-2024/Slides/96304.pdf)
- [LIBRO](https://arxiv.org/pdf/2209.11515)
- [Do Context Files Help Coding Agents?](https://arxiv.org/abs/2607.27250)
- [Vercel AGENTS.md vs skills](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)

**Mining foundations:**
- [Wait For It: on-hold SATD](https://arxiv.org/abs/1901.09511)
- [Automated identification of on-hold SATD](https://arxiv.org/abs/2009.13113)
- [9.6M links in code comments](https://arxiv.org/pdf/1901.07440)

**Decision methods:**
- [MUBench static API-misuse detectors](https://arxiv.org/pdf/1712.00242)
- [UMBRELA](https://arxiv.org/pdf/2406.06519) · [LLM relevance assessment comparison](https://arxiv.org/html/2504.12558v1)
- [LLM4PFA](https://arxiv.org/pdf/2506.10322)
- [QLCoder](https://arxiv.org/abs/2511.08462)
- [mixedbread rerank latency](https://mixedbread.com/blog/mxbai-rerank-v2) · [Jina reranker v2](https://jina.ai/news/jina-reranker-v2-for-agentic-rag-ultra-fast-multilingual-function-calling-and-code-search)

**Tools:**
- [shoulders](https://github.com/mjswensen/shoulders) · [errorscape](https://www.npmjs.com/package/errorscape)
- [depscope get_known_bugs](https://policylayer.com/tools/dev-depscope-mcp/get-known-bugs.md) · [depscope (retired)](https://depscope.dev) · [depoverflow](https://pypi.org/project/depoverflow/0.1.0)
- [canidelete](https://github.com/Telle-dev/canidelete) · [GitHub MCP server](https://github.com/github/github-mcp-server)
- [Socket reachability](https://docs.socket.dev/docs/reachability-analysis) · [Snyk reachability](https://docs.snyk.io/manage-risk/prioritize-issues-for-fixing/reachability)
- [Renovate Merge Confidence](https://docs.renovatebot.com/merge-confidence/) · [Dependabot compatibility score](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates)
- [Context7 comparison (kapa)](https://www.kapa.ai/library/best-mcp-server-for-giving-coding-agents-access-to-documentation) · [Mintlify comparison](https://www.mintlify.com/library/best-mcp-servers-for-coding-agents)

**Pricing:** Claude Haiku 5.5 (`claude-haiku-5-5`) is $0.10 / $0.50 per MTok in, out for prompts ≤100K tokens. Batch API
is 50% off. Taken from the claude-api skill's model table (cached 2026-10-06).
