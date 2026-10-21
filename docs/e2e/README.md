# End-to-end runs (2026-10-21)

Every file in this folder comes from real runs on this machine against live GitHub,
npm and PyPI, plus live agent sessions. Nothing here was edited afterwards except to
format it. The demo project is `examples/demo`.

## 1. Scan (live network)

```sh
cd examples/demo
node ../../dist/cli.js scan --refresh
```

- Output: `scan.txt` (stdout) and `scan.stderr.txt` (progress). Final build, re-run
  live with `--refresh`.
- 7 direct dependencies, from `package-lock.json` and `requirements.txt`.
- The whole scan took 13 s.
- Result: **71 open issues filed against the exact pinned versions**. 53 of them are
  tied to specific symbols and 26 have a workaround in the comments.
- An earlier build reported 84 on the same project. The stricter analysis that came
  out of the accuracy work (docs/ACCURACY.md) drops more search noise.

## 2. Check (no network)

```sh
node ../../dist/cli.js check src/db.ts src/dates.ts app/models.py
```

- Output: `check.txt`.
- The demo's own files use none of the buggy symbols, so nothing matches.
- An earlier build flagged `serial` against drizzle-orm#3333, a MariaDB-only bug, in a
  Postgres file. That false positive led to the dialect filter (DECISIONS D-25).
- `check-closeDb.txt` is a file that calls `db.$client.end()` through
  `drizzle-orm/node-postgres`. It shows `[blocks: also uses drizzle-orm/node-postgres]`.
- `list-drizzle.txt` shows `landmine list drizzle-orm`.

## 3. Live Claude Code session

**Setup.** Claude Code 2.1.304, model `claude-opus-5-5`, permission mode
`acceptEdits`. The hook was installed with `node ../../dist/cli.js install`, which
writes `.claude/settings.json`.

```sh
LANDMINE_DEBUG_LOG=/tmp/lm-e2e-hook.jsonl claude -p "Add an exported async function closeDb() to src/db.ts that closes the underlying Postgres connection pool, so test suites can shut down cleanly. Keep the change small." \
  --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Glob,Grep" --max-turns 15
```

The prompt does not mention landmine, bugs, or `$client`.

**What happened** (`claude-session.jsonl`, `claude-hook-log.jsonl`):

1. Claude read `src/db.ts` and tried an Edit adding `await db.$client.end();`.
2. The landmine hook denied the edit. Claude Code returned the reason to the model as
   `PreToolUse:Edit hook error: landmine: this edit uses `$client.end` from
   drizzle-orm@0.36.0 …`, citing drizzle-team/drizzle-orm#3402 and quoting @cluah's
   comment.
3. Claude changed approach. It created a `pg.Pool` itself, passed it to
   `drizzle(pool)`, and closed it with `pool.end()`. This is the second option in the
   quoted comment. The hook saw this edit and allowed it ("no landmine touched").
4. Claude's final message to the user, verbatim:

   > **Why it's not the obvious one-liner:** my first try was `await db.$client.end()`.
   > The landmine hook blocked it, citing drizzle-orm#3402: in drizzle-orm 0.36.0 (the
   > version this project uses), `$client` may not expose `end()` in its types. The fix
   > suggested in that issue is a `// @ts-expect-error`, which would hide the type
   > error instead of fixing it. So I took the other route the issue mentions: […]

The run took 5 turns, 32 s and $0.26. The resulting file is
`claude-session-result.ts.txt`.

### 3b. Re-run with the final build

After the accuracy work (corroboration, and heads-ups off by default; DECISIONS D-27 to
D-29), the same prompt was run again against the final `dist/`.

- Files: `claude-session-final.jsonl` and `claude-hook-log-final.jsonl`. The model's
  view of the deny is in `claude-deny-message-final.txt`.
- The edit using `db.$client.end()` was again denied once, citing drizzle-orm#3402.
  This time the deny says why it applies: "this file also uses
  `drizzle-orm/node-postgres`, which the issue names".
- Claude switched to an owned `pg.Pool` and told the user why, linking the issue.
- It made 2 more edits, and the hook let both through.
- The run took 7 turns and $0.28.

## 4. Live Codex CLI session

**Setup.** codex-cli 0.159.0. The demo was copied to `/tmp/lm-codex-demo` with its own
`git init`. The hook was installed with `install --harness codex`, which writes
`.codex/hooks.json`.

- **Hook trust.** Codex runs project hooks only after you trust them in `/hooks`. A
  non-interactive `codex exec` has no way to grant that trust, so this run used
  `--dangerously-bypass-hook-trust`.
- **First attempt made no edit.** A skill in this machine's user-level Codex config
  made the agent stop and ask for design approval, so it never called `apply_patch`
  and the hook never fired.
- **Second attempt.** The prompt added "This change is pre-approved: apply it directly
  with apply_patch …".

```sh
LANDMINE_DEBUG_LOG=/tmp/lm-codex-hook.jsonl codex exec -C /tmp/lm-codex-demo -s workspace-write --dangerously-bypass-hook-trust --json "<same prompt> This change is pre-approved: apply it directly with apply_patch, do not ask for approval, and do not run type checks (node_modules is not installed)."
```

**What happened** (`codex-session.jsonl`, `codex-hook-log.jsonl`):

1. Codex's first `apply_patch` added `await db.$client.end();`. landmine denied it,
   citing drizzle-team/drizzle-orm#3402.
2. Codex said: "The direct `db.$client.end()` route is affected by a known issue in this
   project's pinned Drizzle version. I'm switching to an explicitly owned `pg` pool…"
3. Its second patch, using an owned `Pool` with `drizzle({ client: pool })` and
   `pool.end()`, was allowed. The diff is in `codex-session-result.diff`.
4. Its final message: "I used an explicit pool because this project's Drizzle version
   has a known issue with closing its implicit client."

The real payloads from both sessions are test fixtures in `test/fixtures/payloads/`.
`test/hook.test.ts` replays them offline against the final code, and the Codex
`apply_patch` is still denied. The Codex session itself was not re-run live after
the D-27 to D-29 changes.

## Not run live

- **Cursor.** `cursor-agent` is installed but not logged in on this machine.
- **Gemini CLI.** Not installed.

Both adapters follow the documented hook formats and are tested only with payloads
built from those docs.
