## Slice F5: Aider, Zed, Warp, JetBrains Junie, Trae, OpenHands, Pi

Researched 2026-10-21 against GitHub source (raw.githubusercontent / gh api) and official docs. Tags: VERIFIED-SOURCE (read the code), VERIFIED-DOCS (read official docs), UNVERIFIED.

---

### Pi (earendil-works/pi, formerly badlogic/pi-mono; npm `@earendil-works/pi-coding-agent` v1.3.0, ~117k stars)

Note: `gh api repos/badlogic/pi-mono` now redirects to `earendil-works/pi`, and the import path is `@earendil-works/pi-coding-agent`, not `@mariozechner/...`. VERIFIED-SOURCE (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/package.json)

1. **Pre-edit hook: YES.** It's an in-process TypeScript extension event, `pi.on("tool_call", handler)`. The order is `tool_execution_start` → `tool_call` → `tool_execution_update` → `tool_result` → `tool_execution_end`. `tool_call` is described as "Fired before a tool executes. Can block." VERIFIED-SOURCE (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts, `ToolCallEvent`; https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
2. **Config:** Extensions are `.ts`/`.js` files, or dirs with `index.ts`, under `~/.pi/agent/extensions/` (user) or `.pi/extensions/` (project). You can also pass `pi --extension ./x.ts`. They load through jiti, so no build step. There is no JSON hook config, so the extension shells out itself. Minimal example:
   ```ts
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
   import { execFileSync } from "node:child_process";
   export default function (pi: ExtensionAPI) {
     pi.on("tool_call", async (event, ctx) => {
       if (event.toolName !== "edit" && event.toolName !== "write") return;
       try { execFileSync("landmine", ["check", "--json"], { input: JSON.stringify(event), cwd: ctx.cwd }); }
       catch (e: any) { return { block: true, reason: String(e.stdout || e.message) }; }
     });
   }
   ```
   Sources: VERIFIED-DOCS (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md, extensions.md). The `ctx.cwd` property is UNVERIFIED (docs only say ExtensionContext "provides the working directory").
3. **Payload:** `ToolCallEvent = { type: "tool_call", toolCallId, parentToolCallId?, toolName, input }`.
   - Built-in tool names: `bash`, `powershell`, `read`, `edit`, `write`, `grep`, `find`, `ls`.
   - `edit` input is `{ path, edits: [{ oldText, newText }] }`, a multi-edit in one call.
   - `write` input is `{ path, content }`.
   - `event.input` is mutable, so you can rewrite args in place, and no re-validation happens.
   - There's no session id or cwd on the event. Get them from `ctx`.
   - Nested calls (codemode scripts) also pass through `tool_call` with `parentToolCallId`.

   VERIFIED-SOURCE (types.ts L1193-1265; https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/edit.ts, write.ts)
4. **Block:** Return `{ block: true, reason?: string, terminate?: boolean }` (`ToolCallEventResult`). The agent loop converts this to `createErrorToolResult(reason || "Tool execution was blocked")`, which is an error tool result the model sees. A handler that throws also blocks, fail-closed: "A `tool_call` handler failure blocks the tool as a fail-safe". VERIFIED-SOURCE (https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts L745-746; extensions.md "Errors and cleanup").
   - Non-blocking context: a `tool_result` handler can return a replacement `content`, `isError` or `details`. `before_agent_start` can inject a message or system prompt. VERIFIED-SOURCE (types.ts `ToolResultEventResult`, `BeforeAgentStartEventResult`)
5. **Claude Code hook import:** None. No Claude-format hooks JSON reader is documented. A thin extension can exec CC-style hook scripts. VERIFIED-DOCS, absence in extensions.md and configuration.md.
6. **Trust:** Project `.pi/extensions`, `.pi/settings.json` and `.pi/mcp.json` load only after **project trust**. The default `defaultProjectTrust: "ask"` is saved in `~/.pi/agent/trust.json`, and the `/trust` command sets it. Non-interactive modes skip project resources unless `"always"` is set. User-level extensions in `~/.pi/agent/extensions` need no trust. AGENTS.md/CLAUDE.md load regardless of trust. VERIFIED-DOCS (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)
7. **MCP: YES, built in now** (this used to be extension-only). Config is `~/.pi/agent/mcp.json` or `.pi/mcp.json` with `{"mcpServers":{"name":{"command","args","env","cwd"}}}`. There's also `pi mcp add [-l] name -- cmd`, and extensions can call `pi.registerMcpServer()`. VERIFIED-DOCS (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
8. **Rules/skills:**
   - Context files: `AGENTS.md`/`CLAUDE.md` (plus `AGENTS.override.md`) from the agent dir, the cwd and its parents.
   - System-prompt files: `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md`.
   - Agent Skills spec: `SKILL.md` in `~/.pi/agent/skills`, `.pi/skills`, `~/.agents/skills`, and `.agents/skills` (walking up to the repo root).

   VERIFIED-DOCS (configuration.md, https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)

---

### OpenHands (OpenHands/OpenHands ~91k stars; hooks live in OpenHands/software-agent-sdk)

1. **Pre-edit hook: YES.** It's the `PreToolUse` event (config key `pre_tool_use` or `PreToolUse`). Other events: `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`. VERIFIED-SOURCE (https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/hooks/types.py). The docs say this works across Cloud, CLI and local GUI. VERIFIED-DOCS (https://docs.openhands.dev/openhands/usage/customization/hooks)
2. **Config:**
   - Project: `.openhands/hooks.json`, searched only in the working dir with no parent walk.
   - User: `~/.openhands/hooks.json` (`get_user_persistence_dir()`, overridable by `OH_PERSISTENCE_DIR`). The source picks the **first file found**, project before user, rather than merging.

   VERIFIED-SOURCE (https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/hooks/config.py `HookConfig.load`). Shape:
   ```json
   {"pre_tool_use":[{"matcher":"file_editor|apply_patch","hooks":[{"type":"command","command":"landmine hook openhands","timeout":10}]}]}
   ```
   The legacy CC-style `{"hooks":{"PreToolUse":[...]}}` wrapper is also accepted. `matcher` takes `*`, an exact name, or a regex (auto-detected or `/re/`). Hook `type` can be `command`, `prompt` or `agent` (the docs say only command). Each hook also takes `timeout` (default 60) and `async`. VERIFIED-SOURCE (config.py)
3. **Payload:** stdin JSON `{event_type:"PreToolUse", tool_name, tool_input, tool_response, message, session_id, working_dir, metadata}`.
   - Env vars: `OPENHANDS_PROJECT_DIR`, `OPENHANDS_SESSION_ID`, `OPENHANDS_EVENT_TYPE`, `OPENHANDS_TOOL_NAME`.
   - `tool_input` is `action.model_dump()`.
   - Tool names come from class names: `file_editor` (command `view|create|str_replace|insert|undo_edit`, `path`, `file_text`, `old_str`, `new_str`, `insert_line`), `apply_patch` (`patch`, OpenAI V4A format), `planning_file_editor`, and `terminal` (not `Bash`).

   VERIFIED-SOURCE (types.py `HookEvent`; executor.py L481-491; https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-tools/openhands/tools/file_editor/definition.py; sdk/tool/tool.py `__init_subclass__`)
4. **Block:**
   - Exit **2** blocks, with stderr as the reason. Exit 1 does NOT block.
   - Exit 0 with stdout JSON `{"decision":"deny","reason":"..."}` blocks. `{"continue":false}` also blocks.
   - A blocked action becomes a `UserRejectObservation(rejection_reason=reason)` that the model sees.

   VERIFIED-SOURCE (executor.py `HookResult` docstring and L563-590; manager.py `get_blocking_reason`; sdk/agent/agent.py L359-366)
   - Context channel: `additionalContext` is parsed for every event but **only injected for UserPromptSubmit**. PreToolUse and PostToolUse discard it, despite what the docs say. VERIFIED-SOURCE (manager.py `run_pre_tool_use` vs `run_user_prompt_submit`)
5. **Claude Code compat:** The docs say "compatible with Claude Code hooks". It shares exit-code semantics and the `{"hooks":{"PreToolUse":...}}` wrapper, but it does NOT read `.claude/settings.json`. Tool names differ (`terminal`, `file_editor`), and stdin uses `event_type`/`working_dir` instead of `hook_event_name`/`cwd`. CC's `hookSpecificOutput.permissionDecision` is NOT parsed, only top-level `decision`. VERIFIED-SOURCE (executor.py parses only `decision`/`reason`/`additionalContext`/`continue`) and VERIFIED-DOCS
6. **Trust:** None documented. Hooks activate when the repo is opened. VERIFIED-DOCS (hooks page). The SDK also has separate `security` (security analyzer) and confirmation-policy modules. UNVERIFIED for details.
7. **MCP:**
   - CLI: `~/.openhands/mcp.json` `{"mcpServers":{...}}`, written by `openhands mcp add`.
   - GUI: settings store `~/.openhands/settings.json`.
   - Legacy `config.toml [mcp]` is ignored by current releases.

   VERIFIED-DOCS (https://docs.openhands.dev/openhands/usage/settings/mcp-settings)
8. **Rules/skills:**
   - `AGENTS.md` at the repo root goes in full into the system prompt. `CLAUDE.md`/`GEMINI.md` are also recognized.
   - Agent Skills `SKILL.md` live in `.agents/skills/` and `~/.agents/skills/`. Legacy `.openhands/skills/` and `.openhands/microagents/` still work.

   VERIFIED-DOCS (https://docs.openhands.dev/overview/skills)

---

### JetBrains Junie (Junie CLI + Junie in JetBrains IDEs)

1. **Pre-edit hook: YES (Junie CLI only, Early Access).** Events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop`, `StopFailure`, `SessionEnd`. These fire only in the interactive TUI and batch (`-p`) hosts. **ACP and server hosts do not invoke them**, so Junie inside the JetBrains IDE AI Chat (ACP) is not covered. VERIFIED-DOCS (https://junie.jetbrains.com/docs/junie-cli-hooks.html)
2. **Config:** A `"hooks"` object in user `~/.junie/config.json`, in a file passed with `--config-location`, or in an installed extension's `hooks/hooks.json` (Claude plugin layout, with `${CLAUDE_PLUGIN_ROOT}` or `${JUNIE_EXTENSION_ROOT}`). Project `<root>/.junie/config.json` hooks are **ignored by default** for safety. Entries from all sources are concatenated. Only `type:"command"` is supported. Example:
   ```json
   {"hooks":{"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"landmine hook junie","timeout":10}]}]}}
   ```
   VERIFIED-DOCS (same page)
3. **Payload:** a single JSON line on stdin, for example `{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{...}}`. Model-facing tool names include `Bash`, `Write`, `Read`, `Edit`, `Glob`, `Grep`. The fields are documented as "illustrative, not exhaustive". `session_id`/`cwd`/`project_path` are documented for SessionStart and UserPromptSubmit but not shown for PreToolUse. `tool_input` field names for `Write`/`Edit` are UNVERIFIED. `PermissionRequest` sends `{tool_name: Bash|Edit|Read|<mcp>, tool_input, permission_reason}`. VERIFIED-DOCS
4. **Block:**
   - Exit **2** blocks the tool regardless of output.
   - Stdout JSON `{"decision":"block"|"deny"|"ask"|"allow","reason","updatedInput","additionalContext"}` also works: block or deny means "the model receives an error message with the reason".
   - Other non-zero exits only warn.
   - Non-blocking context: `additionalContext`. Non-JSON stdout is treated as additionalContext.
   - `async:true` cannot deny.

   VERIFIED-DOCS
5. **Claude Code compat:**
   - Event names, matcher shape, exit-2 semantics and the StopFailure wire fields all mirror CC ("same hook script can be shared").
   - However, PreToolUse uses top-level `decision` rather than CC's `hookSpecificOutput.permissionDecision`.
   - It doesn't read `.claude/settings.json`, but it **installs Claude-format plugin marketplaces** (`.claude-plugin/marketplace.json`) including `hooks/hooks.json`.

   VERIFIED-DOCS (hooks page; https://junie.jetbrains.com/docs/junie-cli-extensions.html)
6. **Trust:** Project trust prompt ("Keep untrusted / Trust this project / Trust all projects in <parent>"). Untrusted projects don't load project MCP, hooks, extensions, skills or guidelines. Even trusted projects don't auto-run project-config hooks; you must pass `--config-location` explicitly. VERIFIED-DOCS (https://junie.jetbrains.com/docs/junie-cli-configuration.html)
7. **MCP:** `.junie/mcp/mcp.json` (project) or `~/.junie/mcp/mcp.json` (user), shape `{"mcpServers":{"x":{"command","args","env"}}}`. This is shared with Junie in the IDE. VERIFIED-DOCS (https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html)
8. **Rules/skills:**
   - Guidelines resolve in this order: `.junie/AGENTS.md`, then root `AGENTS.md` plus `.junie/playbook.md` plus `.junie/rules/*.md`, then legacy `.junie/guidelines.md`. Global is `~/.junie/AGENTS.md`.
   - Skills: `.junie/skills/`, `~/.junie/skills/`, `.agents/skills/` and `~/.agents/skills/`. It offers to import `.claude/skills`.
   - Separate permission control: `~/.junie/allowlist.json` with `fileEditing`, `executables`, `mcpTools`, etc.

   VERIFIED-DOCS (https://junie.jetbrains.com/docs/guidelines-and-memory.html, agent-skills.html, action-allowlist-junie-cli.html)
   - JetBrains AI Assistant / "Air": not researched. UNVERIFIED.

---

### Trae (ByteDance IDE; plus OSS bytedance/trae-agent)

1. **Pre-edit hook: YES (Trae IDE).** Events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `Notification`. Configure under Settings > Hooks. VERIFIED-DOCS (https://docs.trae.ai/ide/automate-actions-with-hooks; https://docs.trae.ai/ide/hook-configuration-reference). The docs are a JS SPA; the text was extracted from the SSR JSON embedded in the page.
2. **Config:**
   - Global: `~/.trae/hooks.json`. Project: `$PROJECT/.trae/hooks.json`.
   - Optionally import Claude's `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json` with the toggle "Import Hook configuration in CLAUDE". All enabled sources run combined.
   - Shape:
   ```json
   {"version":1,"hooks":{"PreToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"landmine hook trae","timeout":30}]}]}}
   ```
   `matcher` is a regex. `loop_limit` applies to Stop only. VERIFIED-DOCS
3. **Payload:** `{session_id, cwd, hook_event_name, workspace_roots[], tool_use_id, tool_name, llm_tool_name, tool_input}`.
   - Standardized tool names: `Read`, `Write`, `Edit` ("find and replace once"), `Glob`, `Grep`, `LS`, `RunCommand`, `WebSearch`, `WebFetch`, `AskUserQuestion`, `Skill`, `mcp__<server>__<tool>`.
   - Env vars: `TRAE_PROJECT_DIR` and `CLAUDE_PROJECT_DIR`.
   - `tool_input` keys for Write/Edit are UNVERIFIED (not documented).

   VERIFIED-DOCS
4. **Block:**
   - Exit **2** is equivalent to `permissionDecision:"deny"`, and stderr is appended to the model's context as the reason.
   - Alternatively, stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"|"ask"|"allow","permissionDecisionReason":"...","updatedInput":{...}}}`. With parallel hooks the precedence is deny > ask > allow.
   - Context channel: `additionalContext` for SessionStart and UserPromptSubmit (plain stdout too). PostToolUse exit 2 or `decision:block` passes the reason to the model.

   VERIFIED-DOCS
5. **Claude Code compat: YES, it reads CC settings files directly** (opt-in toggle). The docs warn that I/O "may differ" and that tool names differ (`RunCommand` vs `Bash`). VERIFIED-DOCS
6. **Trust:** Creating hooks or enabling the CC import shows a security warning that needs an "Enable" click. There's an execution mode setting: "Run in Sandbox" or "Run Automatically Locally". VERIFIED-DOCS
7. **MCP:**
   - Global: via UI or raw `mcp.json`. Project: `.trae/mcp.json`, after enabling "Project MCP".
   - Shape is the standard `mcpServers`, and `${workspaceFolder}` is substituted.

   VERIFIED-DOCS (https://docs.trae.ai/ide/add-mcp-servers). The exact global file path is UNVERIFIED.
8. **Rules/skills:**
   - User rules: `~/.trae/user_rules`. Project rules: `.trae/rules/*.md` (any subdirectory, with frontmatter `alwaysApply`, `globs`, `description`).
   - `AGENTS.md`, `CLAUDE.md` and `CLAUDE.local.md` can be enabled.
   - Skills: `.trae/skills/`, `~/.trae/skills`, `.agents/skills/`.

   VERIFIED-DOCS (https://docs.trae.ai/ide/rules, /ide/skills)
   - **trae-agent (OSS CLI, 12k stars, last push 2026-02):** has no hooks. Tools are `bash`, `str_replace_based_edit_tool`, `json_edit_tool`, etc. MCP goes in `trae_config.yaml` under `mcp_servers:` plus `allow_mcp_servers:`. VERIFIED-SOURCE (https://github.com/bytedance/trae-agent/blob/main/trae_agent/tools/__init__.py, trae_config.yaml.example)

---

### Zed (Zed Agent)

1. **Pre-edit hook: NO.** No agent hook system exists. `crates/settings_content/src/agent.rs` has no hook settings, and the only "hooks" in the Zed AI docs are Task hooks (`create_worktree`). The closest mechanism is **static tool permissions**, `agent.tool_permissions` with regexes on the path and no external command. VERIFIED-SOURCE (https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/agent.rs) and VERIFIED-DOCS (https://zed.dev/docs/ai/tool-permissions)
2. **Config:** `settings.json`:
   ```json
   {"agent":{"tool_permissions":{"default":"confirm","tools":{"edit_file":{"always_deny":[{"pattern":"\\.env$"}]}}}}}
   ```
   - For `edit_file`/`write_file` the pattern matches the path.
   - Precedence: built-in rules > always_deny > always_confirm > always_allow > default.
   - MCP tools use the form `mcp:<server>:<tool>`.

   VERIFIED-DOCS
3. **Payload:** Not applicable. For reference, the tool inputs are `edit_file {path, edits:[{old_text,new_text}]}` and `write_file {path, content}`. Other tools: `delete_path`, `move_path`, `copy_path`, `create_directory`, `terminal`. VERIFIED-SOURCE (https://github.com/zed-industries/zed/blob/main/crates/agent/src/tools/edit_file_tool.rs, write_file_tool.rs)
4. **Block:** Only through static `always_deny`. No reason channel. VERIFIED-DOCS
5. **Claude Code compat:** No. But Zed hosts Claude Agent, Codex, Gemini CLI, OpenCode, Copilot, Cursor and Pi as **ACP External Agents**, and those agents keep their own native hooks. ACP's `fs/write_text_file {sessionId, path, content}` is the agent-to-client write call, so it's a theoretical interception point for an ACP proxy. VERIFIED-DOCS (https://zed.dev/docs/ai/external-agents; https://agentclientprotocol.com/protocol/file-system)
6. **Trust:** Not applicable.
7. **MCP:** `settings.json` key `"context_servers": {"name": {"command","args","env"}}` (or `url`/`headers`). VERIFIED-DOCS (https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md)
8. **Rules/skills:**
   - Global: `~/.config/zed/AGENTS.md`.
   - Project: the first match of `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`.
   - Skills: `SKILL.md` in `~/.agents/skills/` and `.agents/skills/`.
   - There is a `diagnostics` tool the model can call after edits, which is a pull-based LSP channel.

   VERIFIED-DOCS (https://github.com/zed-industries/zed/blob/main/docs/src/ai/rules.md, instructions.md, skills.md, tools.md)

---

### Warp (Warp Agent / Warp Agent CLI `warp` / legacy Oz CLI `oz`)

1. **Pre-edit hook: NO.** The full docs.warp.dev agents, CLI and automation llms-txt bundles (~1.2 MB) contain zero mentions of agent "hook" apart from webhooks/triggers. The control available is per-profile permissions: "Apply code diffs" set to an autonomy level (always ask / agent decides / always allow), plus a command allow/denylist. VERIFIED-DOCS (https://docs.warp.dev/_llms-txt/agents.txt, https://docs.warp.dev/_llms-txt/warp-agent-cli.txt)
2. **Config:** Not applicable for hooks. Agent Profiles are set in Settings > Agents > Profiles > Permissions, and the CLI has its own watched settings file. VERIFIED-DOCS
3. **Payload:** Not applicable.
4. **Block:** Only via the user approval/diff review UI. No programmatic reason channel. VERIFIED-DOCS
5. **Claude Code compat:** No hook import. However, Warp **reads Claude Code's and Codex's MCP configs** (`~/.claude.json`, `.mcp.json`, `~/.codex/config.toml`) and `.claude/skills` etc. VERIFIED-DOCS
6. **Trust:** Project-scoped MCP servers from any provider need explicit approval. VERIFIED-DOCS
7. **MCP:**
   - Warp's own: `~/.warp/.mcp.json` and `.warp/.mcp.json` (auto-spawn by default).
   - Also reads `~/.agents/.mcp.json`, `.agents/.mcp.json`, Claude's and Codex's files ("requires toggle").

   VERIFIED-DOCS (agents.txt "File-based MCP servers")
8. **Rules/skills:**
   - Project Rules come from `AGENTS.md` (or legacy `WARP.md`), all-caps required, at root and in subdirectories. Global Rules are UI-managed.
   - Skills: `SKILL.md` in `.agents/skills/` (recommended) or `.warp/`, `.claude/`, `.codex/`, `.cursor/`, `.gemini/`, `.copilot/`, `.factory/`, `.github/`, `.opencode/` `skills/` dirs, plus the `~/` equivalents.

   VERIFIED-DOCS

---

### Aider (Aider-AI/aider, ~50k stars; last release v0.86.0 on 2025-08-09; last push 2026-05-22)

1. **Pre-edit hook: NO.** Aider does not use tool calls. Edits are text edit formats (diff, whole, udiff, editblock) applied by `apply_updates()`. The only gate is `allowed_to_edit()`, which interactively asks "Allow edits to file that has not been added to the chat?". The closest channel is the **post-edit** `--lint-cmd` / `--auto-lint` (default True) and `--test-cmd` / `--auto-test` (default False). VERIFIED-SOURCE (https://github.com/Aider-AI/aider/blob/main/aider/args.py L534-557; aider/coders/base_coder.py L1585-1625, L2191-2227)
2. **Config:** CLI flags or `.aider.conf.yml` (home, git root, cwd), for example `lint-cmd: ["python: landmine lint"]` or `"landmine lint"` for all languages, and `auto-lint: true`. VERIFIED-SOURCE (args.py). The YAML key form is per the aider_conf docs, UNVERIFIED in detail.
3. **Payload:** The lint command runs as `cmd + " " + quote(rel_fname)` once per edited file, after the edit is written. There is no stdin payload, diff or session id. VERIFIED-SOURCE (https://github.com/Aider-AI/aider/blob/main/aider/linter.py `run_cmd`)
4. **Block:** It cannot block, because the file is already written (and auto-committed). A non-zero lint exit makes its stdout the "lint errors". Aider asks "Attempt to fix lint errors?" (auto-yes with `--yes-always`) and sends the output to the model as `reflected_message`, which works as a post-edit context channel. The same applies to `--auto-test`. VERIFIED-SOURCE (base_coder.py L1599-1622). Also, git pre-commit hooks are bypassed by default: `--git-commit-verify` defaults to False, which means `--no-verify`. VERIFIED-SOURCE (args.py L492-496)
5. **Claude Code compat:** No. VERIFIED-SOURCE (absence)
6. **Trust:** Not applicable.
7. **MCP: NO** in upstream aider. There are no `mcp` references in args.py or main.py. The fork `cecli-dev/cecli` (formerly aider-ce, ~415 stars) adds MCP. VERIFIED-SOURCE (absence) / UNVERIFIED (fork features)
8. **Rules/skills:** No AGENTS.md auto-load and no skills (0 references in args.py and base_coder.py). Conventions are loaded with `--read CONVENTIONS.md` or `read: [CONVENTIONS.md]` in `.aider.conf.yml`. `--watch-files` handles AI comments. VERIFIED-SOURCE and VERIFIED-DOCS (https://github.com/Aider-AI/aider/blob/main/aider/website/docs/usage/conventions.md)

---

#### Table rows

| agent | pre-edit hook? | block mechanism | context channel | config path | MCP | rules/skills |
|---|---|---|---|---|---|---|
| Pi (earendil-works/pi) | YES: TS extension `pi.on("tool_call")`; tools `edit` {path, edits[{oldText,newText}]}, `write` {path, content} | return `{block:true, reason}`; a thrown handler also blocks (fail-closed) → model gets an error tool result | `tool_result` handler rewrites content; `before_agent_start` message | `~/.pi/agent/extensions/*.ts`, `.pi/extensions/` (project needs trust) | YES, `~/.pi/agent/mcp.json`, `.pi/mcp.json` | AGENTS.md/CLAUDE.md; SKILL.md in `.pi/skills`, `.agents/skills` |
| OpenHands | YES: `PreToolUse`; tools `file_editor`, `apply_patch`, `terminal` | exit 2 (stderr) or stdout `{"decision":"deny","reason"}` → `UserRejectObservation` | none at PreToolUse (additionalContext only used for UserPromptSubmit, per source) | `.openhands/hooks.json`, else `~/.openhands/hooks.json` (first found) | YES, `~/.openhands/mcp.json` (CLI) | AGENTS.md (+CLAUDE.md/GEMINI.md); `.agents/skills`, legacy `.openhands/skills\|microagents` |
| Junie CLI (JetBrains) | YES (EAP): `PreToolUse` and `PermissionRequest`; tools `Write`, `Edit`, `Bash`…; not in ACP/IDE hosts | exit 2, or stdout `{"decision":"block"\|"deny","reason"}` → error to model | `additionalContext` (non-JSON stdout counts too); `updatedInput` | `~/.junie/config.json` `hooks`, `--config-location`, extension `hooks/hooks.json`; project config hooks ignored | YES, `.junie/mcp/mcp.json`, `~/.junie/mcp/mcp.json` | `.junie/AGENTS.md`/AGENTS.md/`.junie/rules`; skills in `.junie/skills`, `.agents/skills` |
| Trae IDE | YES: `PreToolUse`; tools `Write`, `Edit`, `RunCommand`, `mcp__*` | exit 2 (stderr → model) or `hookSpecificOutput.permissionDecision:"deny"` + reason | `additionalContext` (SessionStart/UserPromptSubmit); PostToolUse block reason | `~/.trae/hooks.json`, `.trae/hooks.json`; **optional import of `.claude/settings*.json`** | YES, `.trae/mcp.json` + global UI | `.trae/rules/*.md`, `~/.trae/user_rules`, AGENTS.md/CLAUDE.md opt-in; `.trae/skills`, `.agents/skills` |
| trae-agent (OSS CLI) | NO | n/a | n/a | n/a | YES, `trae_config.yaml` `mcp_servers` | none found |
| Zed Agent | NO (static `agent.tool_permissions` regex on path only) | `always_deny` pattern, no reason | `diagnostics` tool (model pulls LSP) | `settings.json` `agent.tool_permissions` | YES, `settings.json` `context_servers` | `~/.config/zed/AGENTS.md`, first of .rules/.cursorrules/…/AGENTS.md/CLAUDE.md; `.agents/skills` |
| Warp Agent | NO (profile permission "Apply code diffs" plus command denylist) | user approval only | none | Settings > Agents > Profiles | YES, `.warp/.mcp.json`, `~/.warp/.mcp.json`; also reads `.mcp.json`, `~/.claude.json`, `.codex/config.toml` | AGENTS.md (or WARP.md); SKILL.md in `.agents/skills`, `.claude/skills`, etc. |
| Aider | NO (no tool calls); post-edit `--lint-cmd`/`--test-cmd` only | cannot block; non-zero lint output is reflected to the model for a fix | lint/test output as `reflected_message` | `.aider.conf.yml` (`lint-cmd`, `auto-lint`) | NO (upstream) | `--read CONVENTIONS.md`; no AGENTS.md, no skills |
