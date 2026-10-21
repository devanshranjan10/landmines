# Harness integration matrix (research, 2026-10-21)

Synthesised from six research reports (`/tmp/landmine-parts/f1..f6`, not in the repo) plus OpenCode and Cline source. Confidence tags: S = verified from source, D = from docs, I = inferred.

I've read the four landmine source files, all six reports, and the OpenCode and Cline dumps. To settle the OpenCode V1/V2 question I also checked `anomalyco/opencode` on GitHub (`dev`, `v1.19.3`) and opencode.ai/docs/plugins. Local versions are opencode 1.18.33 and cline 3.0.3; I only ran `--version`/`--help`.

# Landmine integration matrix

## Key findings first

1. **OpenCode is now two plugin APIs.** Releases up to v1.19.3, your local 1.18.33, and Kilo 7.8.15 use the V1 API. The `dev` branch has V2, and the docs banner says "New OpenCode v2 is now available". Both the hook API and the edit tool field names differ (`filePath` in V1, `path` in V2). The plugin landmine ships must export both, which is supported since 1.18.29 (`_oc2_plugins.mdx` "Support V1").
2. **Cline file hooks cannot block one tool call.** `{"cancel":true}` becomes `{stop:true}`, then `applyStopControl`, then `throw new ControlledStopError`, which ends the whole run (`_cline_agent-runtime.ts` L2777-2786). The reason goes to `state.lastError`, not to a tool result. Only an in-process plugin returning `{skip:true, reason}` blocks a single call with the reason sent to the model (runtime L2467-2470; `_cline_plugins.mdx` L197).
3. **Exit 2 with the reason on stderr is the most portable deny signal.** About 20 agents honour it, including Windsurf, where it is the only option. `landmine hook` always exits 0 today, so it needs an exit-2 output mode.
4. **`isPreToolEvent` only knows Claude/Cursor/Gemini event names.** Real pre-tool events would be dropped for Vibe (`pre_tool`), Hermes (`pre_tool_call`), Cline CLI (`hookName:"tool_call"`) and Cline VS Code (`hookName:"PreToolUse"`). Windsurf, Goose, OpenHands and Letta carry the event under a different key. Writing landmine's own pre-tool event per harness avoids most of this; Vibe, Hermes and Cline still need their names added.

**Output formats used below:**
- **R-claude:** `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":…}}`
- **R-deny:** `{"decision":"deny","reason":…}` (what landmine's Gemini responder emits today)
- **R-block:** `{"decision":"block","reason":…}`
- **R-exit2:** reason on stderr, exit code 2
- **R-cursor:** `{"permission":"deny","agent_message":…}`

**Confidence tags:** **S** = verified from source, **D** = from docs, **I** = inferred. Fields marked "?" are unverified.

---

## 1. Already supported

**Claude Code**
- Hook: yes, `PreToolUse` command hook.
- Payload: `Edit{file_path,old_string,new_string,replace_all}`, `MultiEdit{file_path,edits[]}`, `Write{file_path,content}`.
- Deny: R-claude (or R-exit2); the reason reaches the model.
- Config: `.claude/settings.json`.
- Fallback: `.mcp.json` `mcpServers`; CLAUDE.md (not AGENTS.md natively).
- Confidence: S (existing code).
- Install change: widen the matcher to `Edit|Write|MultiEdit|edit|write|apply_patch`. Devin CLI reads this file and uses lowercase tool names (f6). The extra alternates are harmless to Claude.

**Codex CLI**
- Hook: yes, `PreToolUse` on `^apply_patch$`.
- Payload: patch text in `tool_input.command`.
- Deny: R-claude.
- Config: `.codex/hooks.json`; needs `/hooks` trust.
- Fallback: user-level MCP via `codex mcp add`; AGENTS.md.
- Confidence: S (existing). The IDE extension is unverified (f6).

**Cursor**
- Hook: yes, `preToolUse` with matcher `Write` in `.cursor/hooks.json`.
- Deny: R-cursor; the reason reaches the model through `agent_message`.
- Fallback: `.cursor/mcp.json`; `.cursor/rules`, AGENTS.md.
- **Contradiction to fix:** f6 says that when Cursor runs a Claude-format hook from `.claude/settings.json`, Claude's `permissionDecisionReason` maps to `user_message` (shown to the user), not the agent (cursor.com third-party-hooks). install.ts claims the `.claude` install covers Cursor. Recommend installing `.cursor/hooks.json` whenever `.cursor/` exists.
- Cursor CLI: whether `preToolUse` fires for file edits is unverified.

**Gemini CLI**
- Hook: yes, `BeforeTool` on `write_file|replace`.
- Payload: `{file_path, content}` and `{file_path, old_string, new_string}`.
- Deny: R-deny, delivered as a tool error.
- Config: `.gemini/settings.json`.
- Fallback: `mcpServers` in the same file; GEMINI.md.
- Confidence: D (untested live).

## 2. Harnesses with shell-command JSON hooks

**GitHub Copilot, VS Code agent ("Local" harness)**
- Hook: yes, `PreToolUse`. **Matchers are ignored**, so landmine filters by tool itself. S
- Payload (snake_case): `{hook_event_name, session_id, cwd, tool_name, tool_input, tool_use_id}`.
  - `replace_string_in_file{filePath,oldString,newString}`
  - `multi_replace_string_in_file{replacements:[{filePath,oldString,newString}]}`
  - `create_file{filePath,content}`
  - `insert_edit_into_file{filePath,code}`: `code` is a sketch with "...existing code..." markers, so treat it as changed text only.
  - `apply_patch{input}`: V4A patch text.
- Deny: R-claude or R-exit2. The model sees `"Tool execution denied: <reason>"`. `additionalContext` is appended as `<PreToolUse-context>`, so warn mode works.
- Config: `.github/hooks/landmine.json` with `{"hooks":{"PreToolUse":[{"type":"command","command":…,"timeout":15}]}}`. Needs Workspace Trust.
- Fallback: `.vscode/mcp.json` `{"servers":{…}}` (marked deprecated); AGENTS.md (default on), `.github/copilot-instructions.md`, `.agents/skills`.
- Post-edit diagnostics only when `github.copilot.chat.agent.autoFix` is on (default false).

**GitHub Copilot CLI**
- Hook: yes. Use the PascalCase `PreToolUse` key, which switches the payload to snake_case: `{hook_event_name, session_id, cwd, tool_name, tool_input}`. D
- Tool names are mapped to Claude's (`edit`/`apply_patch` become `Edit`, `create` becomes `Write`). Argument keys may not be renamed: `create{path,file_text}`?, `edit{path,old_str,new_str}`?.
- The camelCase `preToolUse` sends `toolArgs` as a JSON string. Avoid it.
- Deny: R-exit2 or `{"permissionDecision":"deny","permissionDecisionReason"}`; the reason is "shown to the agent". Fail-closed if the hook errors, fail-open on timeout.
- Config: the **same** `.github/hooks/landmine.json` file. The CLI matcher is anchored `^(?:…)$`; it accepts `bash` and `timeoutSec`, and VS Code normalizes those too. It also reads repo `.claude/settings*.json`, so the existing Claude install already fires; installing both runs landmine twice.
- Fallback: `.mcp.json`/`.github/mcp.json` with `{"mcpServers":{"landmine":{"type":"local","command","args","tools":["*"]}}}`; AGENTS.md.
- Contradiction: whether preToolUse `additionalContext` works (docs omit it, changelog says yes).
- Cloud agent: same format, `.github/hooks/*.json` on the default branch only.

**Windsurf / Devin Desktop (Cascade)**
- Hook: yes, `pre_write_code`. D
- Payload: `{agent_action_name, trajectory_id, execution_id, timestamp, model_name, tool_info:{file_path, edits:[{old_string,new_string}]}}`. No cwd, no `tool_name`.
- Deny: **R-exit2 only**. "The Cascade agent will see the error message from stderr". There is no JSON output channel and no context channel.
- Config: `.devin/hooks.json` (legacy `.windsurf/hooks.json`) with `{"hooks":{"pre_write_code":[{"command":…,"show_output":false}]}}`.
- Fallback: MCP is user-only at `~/.config/devin/mcp_config.json`; `.devin/rules`, AGENTS.md, `.agents/skills`.

**Factory Droid**
- Hook: yes, `PreToolUse`. Payload fields are Claude-identical: `{session_id, cwd, hook_event_name, tool_name, tool_input}`. D
- Tools: `Create{file_path,content}`, `Edit{file_path,…?}`, `ApplyPatch{?}`.
- Deny: R-claude or R-exit2; the reason is sent to Droid. No pre-tool context channel.
- Config: `.factory/hooks.json`, **keyed directly by event, with no `hooks` wrapper**: `{"PreToolUse":[{"matcher":"Create|Edit|ApplyPatch","hooks":[{"type":"command","command","timeout":30}]}]}`.
- Fallback: `.factory/mcp.json` `mcpServers`; AGENTS.md.

**Auggie (Augment CLI)**
- Hook: yes, `PreToolUse`. Payload: `{hook_event_name, conversation_id, workspace_roots[], tool_name, tool_input, is_mcp_tool}`. D, S (bundle)
- Tools:
  - `str-replace-editor{command:"str_replace"|"insert", path, old_str_1, new_str_1, insert_line_1, …_2}`: numbered fields.
  - `save-file{path, file_content}`
  - `apply_patch{input}`?
- Deny: R-claude or R-exit2.
- Config: `.augment/settings.json` in the Claude layout; **`timeout` is in ms**.
- Fallback: `~/.augment/settings.json` `mcpServers`; AGENTS.md, `.augment/rules`.

**Kiro (IDE and CLI V3)**
- Hook: yes, `PreToolUse`. Payload: `{hook_event_name, cwd, session_id, tool_name, tool_input}`. D
- Tools: `fs_write`, `fs_append`, `str_replace`. Argument keys are unverified (closed source).
- Deny: **R-exit2** (stderr goes to the model). In the IDE any non-zero exit blocks. There is no JSON protocol for PreToolUse.
- Config: `.kiro/hooks/landmine.json` with `{"version":"v1","hooks":[{"name":"landmine","trigger":"PreToolUse","matcher":"^(fs_write|fs_append|str_replace)$","action":{"type":"command","command":…},"timeout":30}]}`.
- Fallback: `.kiro/settings/mcp.json`; AGENTS.md, `.kiro/steering`.
- Contradiction: timeout is in seconds in the standalone schema but `timeout_ms` on the CLI actions tab.

**Qwen Code**
- Hook: yes, `PreToolUse`. Payload: `{session_id, cwd, hook_event_name, tool_name, tool_input, tool_use_id}`. S
- Tools: `edit{file_path,old_string,new_string,replace_all}`, `write_file{file_path,content}`. These are Gemini-compatible fields under Claude event names.
- Deny: R-claude or R-exit2. `additionalContext` is appended to the tool result, so warn mode works.
- Config: `.qwen/settings.json` in the Claude layout. Claude matchers (`Edit|Write`) work as aliases. Loads only in trusted folders.
- Fallback: `mcpServers` in the same file; QWEN.md and AGENTS.md.
- Pitfall: `detectHarness` labels `write_file` as `gemini`. Qwen accepts R-deny as a fallback, but install should pin the harness explicitly.

**Crush**
- Hook: yes; `PreToolUse` is its only event. Payload: `{event, session_id, cwd, tool_name, tool_input}`. Note the key is `event`. S
- Tools: `edit{file_path,old_string,new_string,replace_all}`, `multiedit{file_path,edits[]}`, `write{file_path,content}`. These are the Claude field names.
- Deny: R-claude (parsed), native `{"version":1,"decision":"deny","reason","context"}`, or R-exit2. The model sees "Tool call blocked by hook. Reason: …". `context`/`additionalContext` is appended to the tool result.
- Config: `crushrc` line `hook add PreToolUse --matcher "^(edit|multiedit|write)$" --command "…" --name landmine`, or the deprecated `crush.json` with **flat** entries `{"hooks":{"PreToolUse":[{"name","matcher","command","timeout"}]}}`.
- Fallback: MCP under the key **`mcp`** (not `mcpServers`); AGENTS.md. Post-edit LSP diagnostics are appended to tool results.

**Goose**
- Hook: yes, `PreToolUse`, **plugin-only**. Payload: `{event, session_id, tool_name, tool_input, working_dir, tool_call_id}`. S, D
- Tools: `write{path,content}`, `edit{path,before,after}`.
- Deny: R-block or R-exit2. **`hookSpecificOutput` is not parsed.** The model sees "Tool call denied by policy hook…Do not retry". No context channel.
- Config: `.agents/plugins/landmine/plugin.json` (manifest shape I) plus `hooks/hooks.json` with `{"hooks":{"PreToolUse":[{"matcher":"^(write|edit)$","hooks":[{"type":"command","command","timeout":10}]}]}}`.
- Fallback: `extensions:` in `~/.config/goose/config.yaml` (user-level); AGENTS.md, `.goosehints`.

**OpenHands**
- Hook: yes, `PreToolUse`. Payload: `{event_type, tool_name, tool_input, session_id, working_dir}`. S
- Tools: `file_editor{command:create|str_replace|insert, path, file_text, old_str, new_str, insert_line}`, `apply_patch{patch}`.
- Deny: R-deny or R-exit2, delivered as `UserRejectObservation`. **Exit 1 does not block.** `hookSpecificOutput` is not parsed, and pre-tool `additionalContext` is discarded despite the docs.
- Config: `.openhands/hooks.json` with `{"pre_tool_use":[{"matcher":"file_editor|apply_patch","hooks":[{"type":"command","command","timeout":10}]}]}`. **The first file found wins**, so a project file shadows the user's `~/.openhands/hooks.json`. Warn the user about this.
- Fallback: `~/.openhands/mcp.json`; AGENTS.md.

**Junie CLI**
- Hook: yes, `PreToolUse`, CLI only (not in ACP/IDE hosts). Payload: `{hook_event_name, tool_name, tool_input}`; tools `Write`, `Edit`; argument keys unverified. D
- Deny: R-deny/R-block or R-exit2. `additionalContext` is supported.
- Config: **user-level only.** `~/.junie/config.json` `{"hooks":{"PreToolUse":[…Claude layout…]}}`. Project config hooks are ignored by default.
- Fallback: `.junie/mcp/mcp.json`; AGENTS.md, `.junie/AGENTS.md`.

**Trae IDE**
- Hook: yes, `PreToolUse`. Payload: `{session_id, cwd, hook_event_name, workspace_roots, tool_use_id, tool_name, llm_tool_name, tool_input}`; tools `Write`, `Edit`; argument keys unverified. D
- Deny: R-claude or R-exit2.
- Config: `.trae/hooks.json` with `{"version":1,"hooks":{"PreToolUse":[{"matcher":"Write|Edit","hooks":[…]}]}}`. It can also import `.claude/settings*.json` via an opt-in toggle. Needs an "Enable" click.
- Fallback: `.trae/mcp.json`; `.trae/rules`, AGENTS.md (opt-in).

**Antigravity**
- Hook: yes, `PreToolUse`. Payload is camelCase: `{conversationId, workspacePaths, toolCall:{name, args}, stepIdx}`. There is no cwd and no `tool_input`. D
- Tools:
  - `write_to_file{TargetFile, CodeContent, Overwrite}`
  - `replace_file_content{TargetFile, TargetContent, ReplacementContent, AllowMultiple}`
  - `multi_replace_file_content{TargetFile, ReplacementChunks[]}`: chunk fields unverified.
- Deny: R-deny. That the reason reaches the model verbatim is unverified, and exit codes are undocumented.
- Config: `.agents/hooks.json`, **keyed by hook name, then by event**: `{"landmine":{"PreToolUse":[{"matcher":"write_to_file|replace_file_content|multi_replace_file_content","hooks":[{"type":"command","command","timeout":10}]}]}}`.
- Fallback: `.agents/mcp_config.json` `mcpServers`; AGENTS.md/GEMINI.md, `.agents/rules`.

**Smaller hook agents (f6).** The verified/unverified tags below are the f6 report's.

| Agent | Event / config | Payload | Deny | Install note |
|---|---|---|---|---|
| Devin CLI | `PreToolUse`; `.devin/hooks.v1.json`; reads `.claude/settings*.json` by default | lowercase `edit`, `write`, `apply_patch`; `DEVIN_PROJECT_DIR` | R-block or R-exit2 | Same `.devin/` directory as Windsurf's `.devin/hooks.json`; keep them separate. |
| Kimi Code | `PreToolUse`; `[[hooks]]` in `~/.kimi-code/config.toml` (user-only; extra fields fail config load) | `Edit{path,old_string,new_string}`, `Write{path,content}` | R-claude or R-exit2 | |
| Mistral Vibe | `pre_tool`; `.vibe/hooks.toml` (trusted folders) | Legacy keys `file_path/content/old_string/new_string`; tool `file_system.write_file` | R-deny with exit 0 only; exit 2 has no meaning | |
| Hermes | `pre_tool_call`; `~/.hermes/config.yaml` (user-only, consent prompt) | `write_file`/`patch`, `path` | R-block or R-exit2 | |
| Qoder | `.qoder/settings.json` | Claude clone | R-claude or R-exit2 (D) | |
| CodeBuddy | `.codebuddy/settings.json` | Claude clone | R-claude or R-exit2; prefers stdout | Needs `/hooks` review |
| Tabnine CLI | `BeforeTool`; `.tabnine/agent/settings.json` | Gemini clone | R-deny | |
| Snowflake Cortex | `.cortex/settings.json` | Claude-like | R-block or R-exit2 | |
| Firebender | `.firebender/hooks.json` | Cursor clone | R-deny | |
| Letta | `.letta/settings.json` | `event_type`, `working_directory` | R-exit2 | |

**Continue.** The Claude-compatible hook code exists but **never fires** (0 call sites, f1 S). Its `Write` tool uses `filepath`. Treat Continue as MCP + rules only.

## 3. In-process plugin harnesses (no shell hook)

**OpenCode, V1 (shipping)**
- Hook: `"tool.execute.before": async (input:{tool, sessionID, callID}, output:{args})`.
- It fires before the permission prompt (`_oc1_session_tools.ts` L105-109, L403-407), and also for MCP tools.
- Tools: `edit{filePath, oldString, newString, replaceAll?}`, `write{filePath, content}`, `apply_patch{patchText}` (S `_oc1_edit.ts` L47, `_oc1_write.ts` L20, `_oc1_apply_patch.ts` L18).
- On GPT models (not oss, not gpt-4) `apply_patch` replaces **both** edit and write (v1.19.3 `registry.ts` L297-300). Kilo keeps `write`.
- How a thrown error reaches the model:
  1. `trigger` runs `Effect.promise(fn)`; a rejection becomes a defect.
  2. The tool's `execute` rejects, which produces an AI-SDK `tool-error`.
  3. `failToolCall` stores `{status:"error", error: errorMessage(error)}`, which is replayed to the model as the tool error.
  4. The loop continues. Only `PermissionV1.RejectedError` sets `blocked`.
- Config: auto-loaded from `.opencode/plugins/*.ts` or `~/.config/opencode/plugins/`; or the `"plugin": [...]` key in `opencode.json`.
- Init context: `{directory, worktree, project, client, $}` (D, docs page).

**OpenCode, V2 (`dev` branch)**
- Hook: `Plugin.define({id, setup(ctx){ await ctx.tool.hook("execute.before", e => …) }})` with `e.tool` and `e.input`.
- Tools: `edit{path, oldString, newString, replaceAll?}`, `write{path, content}`, `patch{patchText}` (S, fetched).
- A throw becomes `Tool.Error({message})`, and "a rejection fails that call alone" (`_oc2_adapter.ts` L633-642).
- Config: the key is `plugins`; directory `.opencode/plugins/`. Context: `ctx.location.directory`. There is no `$`; use `node:child_process`.
- Fallback for both versions: MCP `"mcp":{"landmine":{"type":"local","command":["landmine","mcp"],"enabled":true}}` (I, from Kilo's identical schema). AGENTS.md (I). A custom LSP via `"lsp"` (D) gives post-edit errors.

**Kilo Code (OpenCode fork v1.18.26, used by both CLI and VS Code)**
- Same V1 hook. Import from `@kilocode/plugin` with `export default {id, server}`.
- Tools: `edit`, `write`, `apply_patch` (as in OpenCode V1).
- Config: `.kilo/plugin/*.ts`, or `"plugin":[]` in `kilo.json[c]`. No trust gate. S, D
- Fallback: `"mcp"` key in `kilo.json[c]`; AGENTS.md, which is a write-protected file in Kilo.

**Cline (SDK-based CLI and VS Code)**
- **File hooks** (S):
  - Location: executable `PreToolUse[.sh|.js|.ts|.py|…]` in `~/Documents/Cline/Hooks`, `~/.cline/hooks`, `<ws>/.clinerules/hooks`, or `<ws>/.cline/hooks` (`_cline_paths.ts` L495-508). VS Code docs say `.clinerules/hooks/PreToolUse` (no extension) plus "Enable Hooks" (`hooksEnabled`).
  - CLI payload: `{hookName:"tool_call", taskId, workspaceRoots:[…], tool_call:{id, name, input}, preToolUse:{toolName, parameters:{k: string}}}`.
  - VS Code payload: `{clineVersion, hookName:"PreToolUse", taskId, workspaceRoots, preToolUse:{toolName, parameters}}`. Parameter values are stringified.
  - Tools: `editor{path, old_text?, new_text, insert_line?}`, `apply_patch{input}` (`_cline_schemas.ts` L194-246).
  - Output: `{cancel, errorMessage, context|contextModification, overrideInput}`. **`cancel` stops the whole run.** `{context}` without `cancel` is injected as a `<hook_context>` block before the next model request, but the edit still runs. `review` is parsed but unused. Hooks are off in `--yolo`; in VS Code a non-JSON non-zero exit fails open.
- **Plugin** (D, S): `.cline/plugins/*.ts` (`resolvePluginConfigSearchPaths`) exporting an `AgentPlugin`, with `hooks.beforeTool({tool, toolCall, input})` returning `{skip:true, reason}`; "the reason goes back to the model".
  - Plugins run in worker threads; use `ctx.cwd`.
  - Verified for the CLI (`cline plugin` exists). **VS Code plugin loading is unverified.**
- Fallback: MCP is user-only at `~/.cline/data/settings/cline_mcp_settings.json`. Rules: AGENTS.md, `.clinerules/`, `.cline/rules`.
- v4 has no post-edit diagnostics (f6 S, negative search).

**Other plugin agents**

| Agent | Hook | Payload | Block | Location |
|---|---|---|---|---|
| Amp | `amp.on('tool.call', (event, ctx))` | `event{tool, input, toolUseID, thread.id}`; tools `edit_file`, `create_file`, `apply_patch`; input keys unverified; `amp.helpers.filesModifiedByToolCall(event)` is the safe route | return `{action:'reject-and-continue', message}` | `.amp/plugins/landmine.ts`. MCP: `amp.mcpServers` in `.amp/settings.json` (needs `amp mcp approve`). (D, S d.ts) |
| Pi | `pi.on("tool_call", (event, ctx))` | `{toolName, input}`; `edit{path, edits:[{oldText,newText}]}`, `write{path,content}` | return `{block:true, reason}`; a throw also blocks (fail-closed) | `.pi/extensions/landmine.ts`, needs project trust. MCP: `.pi/mcp.json`. (S) |
| oh-my-pi | same API | same | same | `.omp/hooks/pre/landmine.ts` (D) |
| OpenClaw | `before_tool_call` | | `{block:true, blockReason}` | Not a coding agent; low priority. |

## 4. No pre-edit hook

| Agent | Status | What landmine can use |
|---|---|---|
| Roo Code | Archived 2026-05 | `.roo/mcp.json`, AGENTS.md; post-edit VS Code Error diagnostics |
| Freebuff/Codebuff | `run_file_change_hooks` is a no-op | `.agents/mcp.json` (trust-gated), AGENTS.md |
| Zed | Static `tool_permissions` only | `context_servers` in settings.json, AGENTS.md |
| Warp | No hooks | `.warp/.mcp.json`; also reads `.mcp.json` (with a toggle); AGENTS.md |
| Aider | No tool calls | Post-edit `lint-cmd` only (see the fallback section); `--read CONVENTIONS.md`; no MCP, no AGENTS.md |
| trae-agent, Rovo Dev | No blocking hooks | MCP only |

## 5. Contradictions and caveats across reports

- **Cursor via `.claude` import:** the reason goes to the user (f6) versus install.ts's note that the `.claude` install covers Cursor.
- **Copilot CLI:** preToolUse `additionalContext` (docs vs changelog), and whether PascalCase renames argument keys.
- **OpenHands and Continue:** the docs claim features the source does not implement (pre-tool context; hooks firing at all).
- **Kiro:** timeout units (seconds vs `timeout_ms`).
- **Auggie:** docs say only `deny` is supported; the bundle schema also accepts `allow|ask`.
- **Kilo vs OpenCode:** Kilo keeps `write` on GPT models; OpenCode v1.19.3 drops it.
- **Devin:** Windsurf/Desktop uses `.devin/hooks.json`; Devin CLI uses `.devin/hooks.v1.json`, same directory. f2 says the Devin Local config path is unstated; f6 gives it.
- **Unverified edit-argument keys:** Droid, Kiro, Junie, Trae, Amp, Copilot CLI, Antigravity chunks, Hermes. Design the normalizer to be alias-tolerant and log unknown shapes through `LANDMINE_DEBUG_LOG`.

---

# Implementation plan

## Step 0: refactor the hook core (prerequisite)

1. **Envelope normalizer** in `payload.ts`:
   - tool: `tool_name | toolName | tool | toolCall.name | tool_call.name | preToolUse.toolName | agent_action_name`
   - input: `tool_input | toolArgs` (JSON-parse if a string) `| args | toolCall.args | tool_call.input | preToolUse.parameters | tool_info`
   - session: add `sessionId | conversationId | trajectory_id | taskId` to `sessionKey`
   - cwd: add `working_dir | working_directory | workspaceRoots[0] | workspacePaths[0]` and the `*_PROJECT_DIR` env vars (`QWEN_`, `AUGMENT_`, `FACTORY_`, `CRUSH_`, `TRAE_`, `DEVIN_`, `OPENHANDS_`) to `workDir`
   - event: `hook_event_name | event | event_type | hookName`. Accept `pre_tool`, `pre_tool_call`, `tool_call`, `pre_write_code`, `pre_tool_use` as pre-tool events.
2. **Field aliases** in `extractEdits`:
   - path: `file_path, filePath, filepath, path, TargetFile`
   - content: `content, file_text, file_content, CodeContent`
   - old/new pairs: `old_string/new_string, oldString/newString, old_str/new_str, old_text/new_text, oldText/newText, before/after, TargetContent/ReplacementContent`
   - numbered pairs: `old_str_N/new_str_N` (Auggie)
   - lists: `edits[], replacements[]` (each item may carry its own `filePath`), `ReplacementChunks[]`
   - patches: `patchText, patch, input` (string) and Copilot `apply_patch.input` into `parseApplyPatch`
   - sketches: `code` (Copilot `insert_edit_into_file`) counts as changedText only
   - Allow-list tool names per harness so non-edit tools that happen to carry `path`+`content` are ignored.
3. **Output modes:** add responders `deny` (R-deny), `block` (R-block), `exit2`, `cline` (`{context}`; `{cancel}` only if the user opts in), and `reason` (plain text on stdout for plugins). `landmine hook` must be allowed to exit 2.
4. **Harness flag:** add `--agent <name>` (alias of `--harness`) and always write it into installed commands. Keep detection as a fallback only.
5. **Install layouts:** generalize `install.ts` with a `wrapper` option: `hooks` key, no wrapper (Droid), `{name:{event}}` (Antigravity), flat entries (Crush), `pre_tool_use` (OpenHands), a v1 array (Kiro), TOML (Kimi/Vibe), and script files (Cline).

## (a) Existing adapter plus a new install target

| Target | File | Responder | Notes |
|---|---|---|---|
| `qwen` | `.qwen/settings.json`, Claude layout, matcher `Edit\|Write` | R-claude | warn works |
| `crush` | append between markers to `.crushrc` (`hook add …`), or `crush.json` flat entries | R-claude | |
| `droid` | `.factory/hooks.json`, no wrapper | R-claude | add `ApplyPatch` to codex-branch detection |
| `trae` | `.trae/hooks.json` with `version:1` | R-claude | |
| `qoder`, `codebuddy` | Claude layout under `.qoder/` / `.codebuddy/` | R-claude | |
| `tabnine` | `.tabnine/agent/settings.json`, Gemini layout | R-deny | |
| `vibe` | `.vibe/hooks.toml` | R-deny | requires the `pre_tool` event fix |
| `firebender` | `.firebender/hooks.json`, Cursor layout | R-deny | |
| `devin` | none needed | | covered by `.claude` once the matcher is widened; detect `DEVIN_PROJECT_DIR` and use R-exit2 |
| `kimi`, `junie`, `hermes` | user-level only | | print a snippet; write only with `--global` |

## (b) New payload adapters

| Target | Install file | Field mapping | Responder |
|---|---|---|---|
| `copilot` (VS Code + CLI, one adapter) | one `.github/hooks/landmine.json`: `{"version":1,"hooks":{"PreToolUse":[{"type":"command","command":…,"bash":…,"matcher":"Edit\|Write\|replace_string_in_file\|multi_replace_string_in_file\|create_file\|insert_edit_into_file\|apply_patch","timeout":15,"timeoutSec":15}]}}` | `filePath/oldString/newString`, `replacements[]`, `create_file.content`, `apply_patch.input`; CLI `path/old_str/new_str/file_text` | R-claude, plus `additionalContext` for warn |
| `windsurf` | `.devin/hooks.json` `pre_write_code` | `tool_info.file_path`, `tool_info.edits[]`; session = `trajectory_id` | R-exit2 |
| `auggie` | `.augment/settings.json` (timeout 10000 ms) | numbered `old_str_N/new_str_N`, `save-file.file_content`, `apply_patch.input` | R-claude |
| `antigravity` | `.agents/hooks.json` | `toolCall.args.{TargetFile, CodeContent, TargetContent, ReplacementContent, ReplacementChunks}`; session = `conversationId` | R-deny |
| `kiro` | `.kiro/hooks/landmine.json` | `tool_input.{path, content\|file_text, old_str\|old_string, new_str\|new_string}` | R-exit2 |
| `goose` | `.agents/plugins/landmine/{plugin.json, hooks/hooks.json}` | `edit{path,before,after}`, `write{path,content}`, `working_dir` | R-block |
| `openhands` | `.openhands/hooks.json` | `file_editor{path, file_text, old_str, new_str}`, `apply_patch.patch`, `working_dir` | R-deny; warn the user about first-file-wins |
| `cline` (file-hook tier) | `.clinerules/hooks/PreToolUse`, a `#!/bin/sh` wrapper `exec … hook --agent cline`, `chmod +x`. The CLI also scans `.clinerules/hooks`, so one file covers both. | `tool_call.input` falling back to `preToolUse.parameters`; `editor{path, old_text, new_text}`, `apply_patch.input` | default to `{context}` (warn, non-stopping) |

## (c) JS/TS plugin files

All plugins shell out with Claude-shaped stdin and read the `--format reason` output. They are fail-open: a timeout or error means allow.

```ts
// shared core (inline in each plugin; ~20 lines)
import { execFileSync } from "node:child_process"
export function landmineReason(agent: string, tool: string, input: unknown, cwd: string, session: string): string | undefined {
  try {
    const out = execFileSync("landmine", ["hook", "--agent", agent, "--format", "reason"], {
      cwd, timeout: 10_000, encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: session, cwd, tool_name: tool, tool_input: input }),
    })
    return out.trim() || undefined
  } catch { return undefined }   // fail open
}

// .opencode/plugins/landmine.ts — dual V1+V2 (and .kilo/plugin/landmine.ts with id/server only)
import { Plugin } from "@opencode/plugin"   // types only; drop for V1-only/Kilo
const EDIT = new Set(["edit", "write", "apply_patch", "patch"])
export default {
  ...Plugin.define({ id: "landmine", async setup(ctx) {
    await ctx.tool.hook("execute.before", (e) => {
      if (!EDIT.has(e.tool)) return
      const r = landmineReason("opencode", e.tool, e.input, ctx.location.directory, (e as any).sessionID ?? "")
      if (r) throw new Error(r)            // -> Tool.Error, fails this call only; model sees message
    })
  }}),
  id: "landmine",
  async server({ directory }: { directory: string }) {
    return { "tool.execute.before": async (input: any, output: any) => {
      if (!EDIT.has(input.tool)) return
      const r = landmineReason("opencode", input.tool, output.args, directory, input.sessionID)
      if (r) throw new Error(r)            // -> tool-error -> part.state.error -> model; loop continues
    } }
  },
}
```

- **Cline** (`.cline/plugins/landmine.ts`):
  ```ts
  export default {
    name: "landmine",
    manifest: { capabilities: ["hooks"] },
    hooks: {
      beforeTool({ toolCall, input }) {
        if (!["editor", "apply_patch"].includes(toolCall.toolName)) return
        const r = landmineReason("cline", toolCall.toolName, input, process.cwd(), "")
        return r ? { skip: true, reason: r } : undefined
      },
    },
  }
  ```
  Session: use the snapshot's conversation id if exposed, otherwise rely on landmine's day-key fallback.
- **Amp** (`.amp/plugins/landmine.ts`): `amp.on('tool.call', …)`. Return `{action:'reject-and-continue', message:r}`, otherwise `{action:'allow'}`. Session = `event.thread.id`; cwd from `ctx.system.workspaceRoot`.
- **Pi** (`.pi/extensions/landmine.ts`) and **oh-my-pi** (`.omp/hooks/pre/landmine.ts`): `pi.on("tool_call", …)`, return `{block:true, reason:r}`.
- Prefer shelling out over importing `landmines`. Plugin hosts (Bun in OpenCode, Cline worker threads with no Bun guarantee, jiti in Pi) resolve npm packages from different roots; one binary on PATH, or an absolute `node …/cli.js` written at install time, is more robust. Throwing an Error is the block channel in OpenCode and Kilo; returning a value is the channel in Cline, Amp and Pi.

## (d) MCP plus rules only

Roo, Continue, Freebuff, Zed, Warp, trae-agent, Aider, and users who decline hooks. Add `landmine install --mcp-for <agent>` that writes:

| Agent | MCP file and key |
|---|---|
| Roo | `.roo/mcp.json` `mcpServers` |
| Freebuff | `.agents/mcp.json` `mcpServers` |
| Zed | `context_servers` in settings |
| Warp | `.warp/.mcp.json` |
| Kiro | `.kiro/settings/mcp.json` |
| Droid | `.factory/mcp.json` |
| Pi | `.pi/mcp.json` |
| Trae | `.trae/mcp.json` |
| Junie | `.junie/mcp/mcp.json` |
| Qwen | `mcpServers` in `.qwen/settings.json` |
| Crush | `mcp` in `crush.json` |
| OpenCode/Kilo | `mcp` (command is an array) |
| Copilot | `.vscode/mcp.json` `servers` and `.mcp.json` `mcpServers` |

User-level only (print the command, don't write): Windsurf, Cline, Goose, Codex, Auggie.

## Universal fallback design (evidence from f6)

There is no hooks standard. Agent Plugins v1 explicitly excludes hooks, the Agent Skills spec has no hooks field, and the AGENTS.md hooks proposal (#149) is not adopted. Agents have converged on Claude's shape and on exit 2. Ranked fallbacks:

1. **Exit-2 mode as the default for unknown harnesses.** Honoured by Claude, Copilot (both), Windsurf, Droid, Auggie, Kiro, Qwen, Crush, Goose, OpenHands, Junie, Trae, Kimi, Devin, Qoder, CodeBuddy, Cortex, Firebender, Letta and Hermes. Exceptions: Vibe (fail-open), Antigravity (undocumented), Cline (no exit semantics).
2. **A managed AGENTS.md section plus an Agent Skill.**
   - AGENTS.md is read by almost every agent above except Claude Code (CLAUDE.md), Gemini CLI (GEMINI.md by default) and Aider.
   - Write a small marker-delimited block (`<!-- landmine:start -->`): "Before editing code that calls a dependency, call the `landmine_check` MCP tool (or run `landmine check <file>`); known open bugs: <top ≤15 symbol → issue → workaround>". Regenerate it on `landmine scan`.
   - Also ship `.agents/skills/landmine/SKILL.md` with the full list. It is read by Kilo, Roo, Copilot, Windsurf, Antigravity, Freebuff, Amp, Droid, Auggie, Goose, Pi, OpenHands, Junie, Trae, Zed, Warp, Kimi, Vibe and Crush, and progressive disclosure keeps prompt cost low.
   - Note that Kilo and Roo treat AGENTS.md as write-protected for the agent, which is fine because landmine writes it, not the agent.
3. **`landmine lsp --stdio` publishing Error diagnostics (post-edit only).** Model-visible automatically in OpenCode/Kilo through the `lsp` config key ("LSP errors detected in this file, please fix:"; ERROR severity only, max 20) and in Crush (diagnostics appended to edit results). In Copilot VS Code it requires `autoFix` or `get_errors`. It does nothing for Cline v4. Medium priority.
4. **Aider `lint-cmd`.** `.aider.conf.yml` `lint-cmd: "landmine check --exit-code"` with `auto-lint: true`. A non-zero exit sends the output to the model as a fix request. Post-edit only.
5. **Git pre-commit:** CI and human backstop only. Aider bypasses it by default (`--git-commit-verify` defaults to False) and it fires too late to steer an agent.
6. **Future: an ACP proxy.** It could veto `session/request_permission` for `kind:"edit"`, but ACP has no reason field in the response, and the proxy-chains RFD is still a draft.

**Suggested order:**
1. Step 0 refactor.
2. Copilot, OpenCode/Kilo plugin, Windsurf, Qwen, Crush, Droid.
3. Cline plugin, Auggie, Antigravity, Goose, OpenHands, Kiro, Trae.
4. AGENTS.md block, Agent Skill and multi-agent MCP install.
5. Pi, Amp, then user-level snippets (Kimi, Junie, Hermes).
6. The LSP server.

Files referenced: `/Users/ranjansrivastav/Downloads/sideproj/landmine/src/hook/{payload,respond,run}.ts`, `/Users/ranjansrivastav/Downloads/sideproj/landmine/src/install.ts`, `/tmp/landmine-parts/_oc1_session_tools.ts`, `_oc1_processor.ts`, `_oc1_plugin_index.ts`, `_oc2_adapter.ts`, `_oc_migrate_v1.mdx`, `_cline_hook-file-hooks.ts`, `_cline_agent-runtime.ts`, `_cline_paths.ts`, `_cline_schemas.ts`, `_cline_vscode_hooks_adapter.ts`, `_cline_plugins.mdx`.