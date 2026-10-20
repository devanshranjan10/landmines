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
