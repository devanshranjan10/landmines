### Augment Code / Auggie CLI (CLI v0.36.0 on npm, 2026-10-20)

1. **Pre-edit hook: YES.** Events: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd` (the hook-input table also lists `Notification`). The bundle `augment.mjs` defines the same set. [VERIFIED-DOCS https://docs.augmentcode.com/cli/hooks; VERIFIED-SOURCE npm `@augmentcode/auggie@0.36.0` bundle]
2. **Config.** All files use the `hooks` key. Precedence: `/etc/augment/settings.json` (system/managed) > `<ws>/.augment/settings.local.json` (CLI only) > `<ws>/.augment/settings.json` (CLI only) > `~/.augment/settings.json` (user; the docs table says "CLI, VSCode, IntelliJ" read it). Plugins can also ship `plugins/<name>/hooks/hooks.json`. [VERIFIED-DOCS hooks + https://docs.augmentcode.com/cli/plugins.md]
   ```json
   {"hooks":{"PreToolUse":[{"matcher":"str-replace-editor|save-file|apply_patch|remove-files",
     "hooks":[{"type":"command","command":"landmine check --agent auggie","timeout":5000}]}]}}
   ```
   `matcher` is a case-sensitive regex (default `.*`). `timeout` is in **ms** (default 60000). The only type is `command`. [VERIFIED-DOCS]
3. **Payload (stdin).** Fields: `hook_event_name`, `conversation_id` (this is the session id; there is **no** `session_id`), `workspace_roots[]` (there is **no** `cwd`), `tool_name`, `tool_input`, `is_mcp_tool`. PostToolUse adds `tool_output`, `tool_error`, `file_changes[]`. Env vars: `AUGMENT_PROJECT_DIR`, `AUGMENT_CONVERSATION_ID`, `AUGMENT_HOOK_EVENT`, `AUGMENT_TOOL_NAME`. [VERIFIED-DOCS]
   Edit tools and their `tool_input` shapes:
   - `str-replace-editor`: `{command:"str_replace"|"insert", path, old_str_1, new_str_1, old_str_start_line_number_1, old_str_end_line_number_1, insert_line_1, …_2…}`. The fields are numbered, and one call can carry several edits.
   - `save-file`: `{path, file_content, add_last_line_newline}`
   - `remove-files`
   - `apply_patch`: Codex-style `*** Begin Patch` text in `input`, probably for GPT models.
   [VERIFIED-SOURCE bundle schemas; apply_patch's `input` field name is inferred from the bundle renderer, so it is partly UNVERIFIED]
4. **Block and context.**
   - Exit `2` blocks. Stderr goes to the agent and the user.
   - Alternatively, exit `0` with JSON `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"…"}}`. The docs say only `"deny"` is supported, but the bundle's zod schema accepts `allow|deny|ask` and `updatedInput`.
   - Any other exit code is a non-blocking error.
   - Context channel: `hookSpecificOutput.additionalContext` on PostToolUse, and stdout or `additionalContext` on SessionStart. No PreToolUse context channel is documented. The common schema has `systemMessage` and `additionalContext`.
   [VERIFIED-DOCS; VERIFIED-SOURCE for the schema]
5. **Claude Code compatibility.**
   - The JSON shape (`hooks`/`matcher`/`hooks[]`, `hookSpecificOutput.permissionDecision`, exit 2) mirrors Claude Code.
   - The plugin system "recognizes both `.augment-plugin` and `.claude-plugin`" and treats `${CLAUDE_PLUGIN_ROOT}` as an alias. Claude Code plugins with `hooks/hooks.json` load.
   - Tool names differ (`str-replace-editor`, not `Edit`), and I found no `Edit|Write` alias mapping in the bundle. Claude-targeted matchers therefore won't fire on edits.
   - It does not read `.claude/settings.json` hooks.
   [VERIFIED-DOCS https://docs.augmentcode.com/cli/plugins.md; VERIFIED-SOURCE (absence of mapping)]
6. **Trust.** No hook trust or approval step is documented, and I saw none in the bundle. Hooks run automatically. [VERIFIED-DOCS (absence); otherwise UNVERIFIED]
7. **MCP.** `mcpServers` in `~/.augment/settings.json`, e.g. `{"mcpServers":{"landmine":{"command":"landmine","args":["mcp"],"env":{}}}}`. Also `auggie mcp add|add-json`, `--mcp-config`, and plugin `.mcp.json`. The VS Code/JetBrains extensions use the Settings panel → MCP ("Import from JSON", same `mcpServers` shape). [VERIFIED-DOCS https://docs.augmentcode.com/cli/integrations.md, https://docs.augmentcode.com/setup-augment/mcp.md]
8. **Rules and skills.**
   - Rules: `--rules` file, `CLAUDE.md`, `AGENTS.md` (hierarchical up to the workspace root), `.augment-guidelines`, `.augment/rules/*.md` (frontmatter `type: always_apply|agent_requested|manual`), and `~/.augment/rules/`.
   - Skills (agentskills.io): `~/.augment/skills`, `.augment/skills`, `~/.claude/skills`, `.claude/skills`, `~/.agents/skills`, `.agents/skills`.
   [VERIFIED-DOCS https://docs.augmentcode.com/cli/rules.md, https://docs.augmentcode.com/cli/skills.md]

### Kiro (IDE 1.x and Kiro CLI V3; closed source, so docs only)

1. **Pre-edit hook: YES.** The trigger is `PreToolUse`, labelled "Pre Tool Use" in the IDE. It is in both the IDE and the CLI. Other triggers: `PromptSubmit/UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, `PostToolUse`, `PostFileCreate`, `PostFileSave`, `PostFileDelete`, `PreTaskExec`, `PostTaskExec`, `Manual`. File triggers are post-only, so there is no pre-save file hook. [VERIFIED-DOCS https://kiro.dev/docs/hooks/types.md, https://kiro.dev/docs/cli/v3/hooks-migration.md]
2. **Config.**
   - Standalone files: `.kiro/hooks/*.json` (any filename) in the project, and `~/.kiro/hooks/*.json` (global, CLI V3). This format was introduced in IDE 1.0 and CLI V3.
   - Profile-scoped alternative: a `hooks` array inside a custom agent config (`.kiro/agents/*.json` or `~/.kiro/agents/`).
   - The CLI 2.x legacy object form (`{"hooks":{"preToolUse":[{"command":…,"matcher":"fs_write"}]}}`) is still accepted.
   [VERIFIED-DOCS https://kiro.dev/docs/hooks.md, https://kiro.dev/docs/custom-agents/configuration-reference.md]
   ```json
   {"version":"v1","hooks":[{"name":"landmine","trigger":"PreToolUse",
     "matcher":"^(fs_write|fs_append|str_replace|delete_file)$",
     "action":{"type":"command","command":"landmine check --agent kiro"},"timeout":30}]}
   ```
   - The `write` category tag also works as a matcher.
   - `timeout` is in seconds (default 60) in the standalone schema. The CLI actions tab mentions `timeout_ms` (default 30000) and `cache_ttl_seconds`; this is a doc inconsistency.
   [VERIFIED-DOCS https://kiro.dev/docs/hooks/actions.md]
3. **Payload (stdin JSON).**
   - Fields: `hook_event_name`, `cwd`, `session_id`, `tool_name`, `tool_input`. PostToolUse adds `tool_response`. The CLI V2 engine also sends `tool_tags`.
   - Example: `"tool_name":"read_file","tool_input":{"path":"…"}`.
   - MCP tools appear as `mcp_<server>_<tool>`.
   - V3 write tool IDs: `fs_write` (create/overwrite), `fs_append`, `str_replace`, `delete_file`. The CLI 2.x name was `fs_write` with a `command` sub-field.
   - **UNVERIFIED:** the `tool_input` field names for `fs_write` and `str_replace` (no published schema, closed source). Expect `path` plus content or old/new strings.
   [VERIFIED-DOCS https://kiro.dev/docs/hooks/types/ (JSON examples in the rendered HTML), https://kiro.dev/docs/tools.md]
4. **Block and context.**
   - CLI: exit `2` blocks and returns stderr to the LLM. Exit `0` allows. Other codes warn and allow.
   - IDE (Shell Command action tab): "any other exit code … the tool invocation is blocked", with stderr sent to the agent.
   - Context: exit 0 stdout is added to context on SessionStart and UserPromptSubmit and ignored on other events. An `"agent"` action type injects a prompt instead (this costs credits).
   - No JSON decision protocol is documented for PreToolUse. `{"decision":"block"}` exists only for Stop, where it means "keep going".
   [VERIFIED-DOCS https://kiro.dev/docs/hooks/actions.md, /hooks/types.md]
5. **Claude Code compatibility.** Event names and stdin field names (`hook_event_name`, `tool_name`, `tool_input`, `cwd`, `session_id`) are Claude-like, and exit 2 matches. However, it does not read `.claude/settings.json`, uses a different file schema (`version`/`trigger`/`action`), has no `hookSpecificOutput` support documented, and uses different tool names. [VERIFIED-DOCS (no mention of Claude anywhere in the hooks docs)]
6. **Trust.** No trust gate is documented. Hooks "activate automatically when a session starts". `confirm` prompts exist only for `Stop` command hooks. [VERIFIED-DOCS https://kiro.dev/docs/hooks.md]
7. **MCP.** Workspace `.kiro/settings/mcp.json` and user `~/.kiro/settings/mcp.json`, e.g. `{"mcpServers":{"landmine":{"command":"landmine","args":["mcp"],"env":{},"disabled":false,"autoApprove":[]}}}`. Also `kiro-cli mcp add --name … --scope global --command …`, and an agent-config `mcpServers`/`includeMcpJson`. [VERIFIED-DOCS https://kiro.dev/docs/mcp/configuration.md]
8. **Rules and skills.**
   - Steering: `.kiro/steering/*.md` and `~/.kiro/steering/`, with `inclusion: always|fileMatch|manual|auto` frontmatter.
   - **AGENTS.md is supported**: at the workspace root, in subdirectories, and in `~/.kiro/steering/`. It is always included.
   - Skills (agentskills.io): `.kiro/skills/` and `~/.kiro/skills/`.
   - Kiro also speaks ACP.
   [VERIFIED-DOCS https://kiro.dev/docs/steering.md, https://kiro.dev/docs/skills.md, https://kiro.dev/docs/acp.md]

### Qwen Code (QwenLM/qwen-code @ 7d27f47, 2026-10-21; 28.6k stars)

1. **Pre-edit hook: YES.** It did **not** keep Gemini CLI's `BeforeTool`. The `HookEventName` enum uses **Claude Code names**: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest`, `PermissionDenied`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart/Stop`, `PreCompact/PostCompact`, `Notification`, `InstructionsLoaded`, `TodoCreated/Completed`, etc. [VERIFIED-SOURCE https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/hooks/types.ts]
2. **Config.**
   - The `hooks` key goes in `~/.qwen/settings.json` (user), `.qwen/settings.json` (project), or the system file (`/Library/Application Support/QwenCode/settings.json` on macOS, `/etc/qwen-code/settings.json` on Linux). Agent frontmatter can also declare hooks.
   - Hook types: `command`, `http`, `prompt`, `function` (SDK).
   - Global kill switch: `disableAllHooks`.
   [VERIFIED-DOCS https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md, docs/users/configuration/settings.md]
   ```json
   {"hooks":{"PreToolUse":[{"matcher":"^(edit|write_file|notebook_edit)$",
     "hooks":[{"type":"command","command":"landmine check --agent qwen","timeout":10}]}]}}
   ```
   `timeout` is in seconds; values ≥1000 are treated as ms for legacy configs. [VERIFIED-DOCS]
3. **Payload.**
   - Common fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`, `permission_mode`, plus optional `agent_id` and `prompt_id`.
   - PreToolUse adds: `tool_name`, `tool_input`, `tool_use_id`, and optional `tool_call_id`.
   - Edit tools: `edit` `{file_path, old_string, new_string, replace_all?}` (legacy alias `replace`), `write_file` `{file_path, content}`, and `notebook_edit`.
   - Env vars: `QWEN_PROJECT_DIR`, **`CLAUDE_PROJECT_DIR`**, and `GEMINI_PROJECT_DIR` are all set.
   [VERIFIED-SOURCE types.ts, tools/tool-names.ts, tools/edit.ts, tools/write-file.ts]
4. **Block and context.**
   - Exit `2` blocks, with stderr as feedback to the model (stdout is ignored).
   - Exit 0 with JSON `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"|"allow"|"ask","permissionDecisionReason":"…","updatedInput":{…},"additionalContext":"…"}}` also works. The top-level `decision:"block"|"deny"` is accepted as a fallback.
   - Other exit codes are non-blocking.
   - **Context channel:** PreToolUse `additionalContext` is appended to that call's tool result whatever the decision. Plain stdout becomes context on SessionStart and UserPromptSubmit.
   - `"ask"` falls back to deny in headless mode and in ACP.
   [VERIFIED-SOURCE hooks/hookRunner.ts L1594-1680, L1752-1800; VERIFIED-DOCS]
5. **Claude Code compatibility: high.**
   - Same config shape, payload names, output envelope and exit codes.
   - Matchers accept Claude tool names as aliases ("a matcher copied from a Claude Code config such as `"Bash"` or `"Write|Edit"` works unchanged").
   - `qwen extensions install` converts Claude Code plugins, including `hooks` and `hooks/hooks.json`.
   - It does not read `.claude/settings.json` directly.
   [VERIFIED-DOCS hooks.md L420; VERIFIED-SOURCE packages/core/src/extension/claude-converter.ts L420-447, L695-718]
6. **Trust.** "Hooks in a project's `.qwen/settings.json` load only when the folder is trusted. User hooks load regardless." Hooks are off under `--safe-mode` and `--bare`. [VERIFIED-DOCS hooks.md L39, L1785]
7. **MCP.** `mcpServers` in `~/.qwen/settings.json` or `.qwen/settings.json`, e.g. `{"mcpServers":{"landmine":{"command":"landmine","args":["mcp"]}}}`. Also `qwen mcp add [--scope user]`. [VERIFIED-DOCS docs/users/features/mcp.md]
8. **Rules and skills.**
   - `QWEN.md` (`~/.qwen/QWEN.md` plus the project). It also reads `AGENTS.md`.
   - Path-scoped rules in `.qwen/rules/` and `~/.qwen/rules/` (project rules need trust).
   - Skills: `.qwen/skills/` and `~/.qwen/skills/` (agentskills.io).
   - It also loads Agent Plugins v1 packages (agent-plugins.org), which ignore hooks.
   [VERIFIED-DOCS memory.md, rules.md, skills.md, extension/agent-plugins.md]

### Crush (charmbracelet/crush v0.98.1, 2026-10-09; main @ 2ec8c1e; 28.7k stars)

1. **Pre-edit hook: YES, and `PreToolUse` is the only event.** UserPromptSubmit is planned. Event names are case-insensitive and snake-case is accepted. Hooks fire only for top-level agent tool calls, not sub-agents. [VERIFIED-SOURCE internal/hooks/, docs/hooks/README.md, docs/hooks/FUTURE.md]
2. **Config.**
   - New format (main and v0.98.1): bash-like `crushrc` at `./.crushrc`, `./crushrc`, or `$XDG_CONFIG_HOME/crush/crushrc`, e.g. `hook add PreToolUse --matcher "^(edit|multiedit|write)$" --command "landmine check --agent crush" --name landmine`.
   - **Legacy JSON (deprecated but supported):** `.crush.json` / `crush.json` in the project, or `~/.config/crush/crush.json`. Project overrides global, and crushrc overrides JSON in the same directory.
   ```jsonc
   {"hooks":{"PreToolUse":[{"name":"landmine","matcher":"^(edit|multiedit|write)$","command":"landmine check --agent crush","timeout":10}]}}
   ```
   Note the **flat** entry: there is no nested `hooks[]`. `timeout` is in seconds (default 30). The command is resolved relative to the cwd, so global configs need an absolute path.
   [VERIFIED-SOURCE docs/config/README.md L86-99, L372-410; internal/shellconfig/hook.go exists at tag v0.98.1]
3. **Payload (stdin).**
   - Fields: `{"event","session_id","cwd","tool_name","tool_input"}`. The event key is `event`, **not** `hook_event_name`.
   - Env vars: `CRUSH_EVENT`, `CRUSH_TOOL_NAME`, `CRUSH_SESSION_ID`, `CRUSH_CWD`, `CRUSH_PROJECT_DIR`, `CRUSH_TOOL_INPUT_FILE_PATH`, `CRUSH_TOOL_INPUT_COMMAND`, and `CRUSH=1`/`AGENT=crush`/`AI_AGENT=crush`.
   - Edit tools:
     - `edit` `{file_path, old_string, new_string, replace_all}`
     - `multiedit` `{file_path, edits:[{old_string,new_string,replace_all}]}`
     - `write` `{file_path, content}`
     - LSP-driven edits: `lsp_rename` `{symbol,…}` and `lsp_replace_symbol`.
   [VERIFIED-SOURCE internal/hooks/input.go L19-75; internal/agent/tools/{edit,multiedit,write}.go]
4. **Block and context.**
   - Exit codes: `2` blocks, with stderr as the reason. **`49` halts the whole turn.** `0` means stdout is parsed as JSON. Other codes are non-blocking.
   - JSON envelope: `{"version":1,"decision":"allow"|"deny"|null,"halt":bool,"reason":"…","context":"…"|[…],"updated_input":{…}}`.
   - `allow` **skips the permission prompt**. `updated_input` is a shallow merge.
   - The model sees `"Tool call blocked by hook. Reason: …"` as a tool error.
   - Context channel: `context`, appended to the tool result.
   [VERIFIED-SOURCE internal/agent/hooked_tool.go L28-70, docs/hooks/README.md]
5. **Claude Code compatibility.**
   - The docs say "Hooks are Claude Code-compatible". The source parses `hookSpecificOutput.{permissionDecision,permissionDecisionReason,updatedInput,additionalContext}` (input.go L79-172), and `tool_input` is emitted as an object "for compatibility with Claude Code hooks".
   - Caveats: the stdin key is `event` (not `hook_event_name`); the config shape is flat; tool names are lowercase (`edit`, `write`, `multiedit`); `updated_input` merges rather than replaces. It does not read `.claude/settings.json`.
   [VERIFIED-SOURCE]
6. **Trust.** None. `crush.json` and `crushrc` are "trusted code" (`$(...)` runs at load), and the README warns "Don't launch Crush in a directory whose config you haven't reviewed." [VERIFIED-DOCS README.md L324]
7. **MCP.**
   - JSON: `{"mcp":{"landmine":{"type":"stdio","command":"landmine","args":["mcp"],"env":{}}}}`. The key is **`mcp`, not `mcpServers`**.
   - crushrc: `mcp add landmine --command landmine --args mcp`.
   - Transports: `stdio`, `http`, `sse`.
   [VERIFIED-SOURCE README.md L413-470, internal/config]
8. **Rules and skills.**
   - Context files auto-loaded: `AGENTS.md`/`agents.md`, `CRUSH.md`/`crush.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`, and others. Global: `~/.config/crush/CRUSH.md` and `~/.config/AGENTS.md`.
   - Skills: project `.agents/skills`, `.crush/skills`, `.claude/skills`, `.cursor/skills`; global `~/.config/crush/skills`, `~/.config/agents/skills`, `~/.agents/skills`, `~/.claude/skills`; plus `options.skills_paths`.
   - It ships a built-in `crush-hook` skill.
   - **LSP:** `edit` and `write` append `getDiagnostics()` output to the tool result.
   [VERIFIED-SOURCE internal/config/config.go L26-45, load.go L1310-1350, tools/edit.go L99, tools/write.go L164]

### Goose (aaif-goose/goose, formerly block/goose; v1.55.0, 2026-10-16; 55.5k stars)

1. **Pre-edit hook: YES.** It has `PreToolUse`, which can block. It also has `PreToolUseResult` (observe-only), `PostToolUse`, `PostToolUseFailure`, `SessionStart`, `SessionEnd`, `Stop` (can block, meaning "continue"), `UserPromptSubmit`, `BeforeReadFile`, `AfterFileEdit`, `BeforeShellExecution`, and `AfterShellExecution`. There is **no `BeforeFileEdit`**, so edits are gated through `PreToolUse` with matcher `^(write|edit)$`. [VERIFIED-SOURCE crates/goose/src/hooks/mod.rs L54-67; VERIFIED-DOCS documentation/docs/guides/context-engineering/hooks.md]
2. **Config.**
   - Hooks exist **only inside plugins**, following the "Open Plugins hooks specification" (open-plugins.com).
   - Plugin locations: `~/.agents/plugins/<name>/hooks/hooks.json` (user), `<project>/.agents/plugins/<name>/hooks/hooks.json` (project), or the goose plugin install dir.
   - Manifest at `plugin.json`, `.plugin/plugin.json` or `.goose-plugin/plugin.json`. Disable with `disabledPlugins` in `~/.config/goose/settings.json` or `<project>/.config/goose/settings.json`.
   [VERIFIED-SOURCE plugins/discovery.rs, plugins/formats/open_plugins.rs L14-17]
   ```json
   {"hooks":{"PreToolUse":[{"matcher":"^(write|edit)$","hooks":[{"type":"command",
     "command":"landmine check --agent goose","timeout":10,"on_failure":"block"}]}]}}
   ```
   `${PLUGIN_ROOT}` is expanded. `timeout` is in seconds (default 30). The command runs via `sh -c`.
3. **Payload (stdin).**
   - Fields: `event` (not `hook_event_name`), `session_id`, `matcher_context`, `tool_name`, `tool_input`, `working_dir` (not `cwd`), and `tool_call_id`.
   - Built-in edit tools: `write` `{path, content}` and `edit` `{path, before, after}`. Other extensions' tools are named `{ext}__{tool}`.
   [VERIFIED-DOCS hooks.md "Hook Payload" and "Tool Input Keys"; VERIFIED-SOURCE `working_dir` field, hooks/mod.rs L244]
4. **Block and context.**
   - Exit `2` blocks with the stderr reason, **or** stdout `{"decision":"block","reason":"…"}` blocks at any exit code.
   - Exit 0 with empty stdout, or `{"decision":"allow"}`, allows.
   - Anything else counts as "no decision": fail-open by default, fail-closed with `on_failure:"block"`.
   - The model sees: "Tool call denied by policy hook `<plugin>`: <reason>. Do not retry; this is a policy denial, not a transient failure."
   - **No non-blocking context channel:** there is no `additionalContext` anywhere in hooks/mod.rs.
   [VERIFIED-SOURCE (grep), VERIFIED-DOCS]
5. **Claude Code compatibility: partial.**
   - The `hooks.json` nesting is the Claude shape, and exit 2 and `{"decision":"block"}` (Claude's legacy top-level form) work.
   - It does **not** parse `hookSpecificOutput.permissionDecision`, and it does not discover `.claude-plugin/` (only Open Plugins and Gemini formats) or `.claude/settings.json`.
   [VERIFIED-SOURCE plugins/formats/{open_plugins,gemini}.rs]
6. **Trust.** I found no trust gate for project `.agents/plugins` in discovery.rs; the docs only warn "Run trusted hooks only". Tool-approval modes are separate (`GOOSE_MODE` auto/approve/smart_approve/chat, and `permission.yaml`). [VERIFIED-SOURCE (absence), VERIFIED-DOCS]
7. **MCP ("extensions").** `~/.config/goose/config.yaml`:
   ```yaml
   extensions:
     landmine:
       name: landmine
       type: stdio
       cmd: landmine
       args: [mcp]
       enabled: true
       envs: {}
       timeout: 300
   ```
   Plugins can also ship `.mcp.json` (`mcpServers`). [VERIFIED-DOCS documentation/docs/getting-started/using-extensions.md L323; VERIFIED-SOURCE plugins/mcp_servers.rs L12]
8. **Rules and skills.**
   - `AGENTS.md` and `.goosehints`, loaded nested per directory. Configure the list with `CONTEXT_FILE_NAMES` (e.g. `["CLAUDE.md",".goosehints"]`).
   - Skills: `~/.agents/skills/` and `.agents/skills/`, plus back-compat `.goose/skills/`, `.claude/skills/`, `~/.claude/skills/`.
   - Recipes are YAML session templates, not hooks.
   [VERIFIED-DOCS using-goosehints.md L118, L239; using-skills.md L50-58]

#### Table rows
| agent | pre-edit hook? | block mechanism | context channel | config path | MCP | rules/skills |
|---|---|---|---|---|---|---|
| Auggie (Augment CLI) | Yes: `PreToolUse` (tools `str-replace-editor`, `save-file`, `apply_patch`, `remove-files`) | exit 2 + stderr, or `hookSpecificOutput.permissionDecision:"deny"` + `permissionDecisionReason` | `additionalContext` on PostToolUse/SessionStart only (none documented for PreToolUse) | `.augment/settings.json`, `.augment/settings.local.json`, `~/.augment/settings.json`, `/etc/augment/settings.json`; plugin `hooks/hooks.json` (`.claude-plugin` accepted) | `mcpServers` in `~/.augment/settings.json`; `auggie mcp add` | AGENTS.md, CLAUDE.md, `.augment/rules`; skills in `.augment`/`.claude`/`.agents/skills` |
| Kiro (IDE + CLI V3) | Yes: `PreToolUse` (`fs_write`, `fs_append`, `str_replace`, `delete_file`, or tag `write`) | CLI: exit 2 + stderr to LLM. IDE: any non-zero exit blocks | exit-0 stdout only on SessionStart/PromptSubmit; `"agent"` action injects a prompt | `.kiro/hooks/*.json`, `~/.kiro/hooks/*.json` (`{"version":"v1","hooks":[…]}`); agent profile `hooks` array | `.kiro/settings/mcp.json`, `~/.kiro/settings/mcp.json` (`mcpServers`) | AGENTS.md (yes), `.kiro/steering`; skills in `.kiro/skills` |
| Qwen Code | Yes: `PreToolUse` (`edit`, `write_file`, `notebook_edit`); Claude-named, not Gemini `BeforeTool` | exit 2 + stderr, or `permissionDecision:"deny"` + reason (also `ask`, `updatedInput`) | PreToolUse `additionalContext` appended to the tool result | `hooks` in `.qwen/settings.json` (trusted folder only), `~/.qwen/settings.json`, system settings | `mcpServers` in `.qwen/settings.json` / `~/.qwen/settings.json` | QWEN.md + AGENTS.md, `.qwen/rules`; skills in `.qwen/skills` |
| Crush | Yes: `PreToolUse` only event (`edit`, `multiedit`, `write`, `lsp_rename`, `lsp_replace_symbol`) | exit 2 + stderr (exit 49 halts turn), or JSON `decision:"deny"` + `reason`; also parses Claude `hookSpecificOutput` | JSON `context` (or Claude `additionalContext`) appended to tool result | `crushrc` (`hook add …`), legacy `crush.json` / `.crush.json` / `~/.config/crush/crush.json` (flat entries) | `"mcp":{name:{type:"stdio",command,args}}` (key is `mcp`) | AGENTS.md / CRUSH.md / CLAUDE.md / `.cursorrules` etc.; skills in `.agents`/`.crush`/`.claude`/`.cursor` skills |
| Goose | Yes: `PreToolUse` (`write`, `edit`); no BeforeFileEdit | exit 2 + stderr, or stdout `{"decision":"block","reason":…}`; `on_failure:"block"` for fail-closed | none (no `additionalContext`) | plugin-only: `.agents/plugins/<name>/hooks/hooks.json`, `~/.agents/plugins/<name>/hooks/hooks.json` (Open Plugins spec) | `extensions:` in `~/.config/goose/config.yaml` (type stdio, cmd, args); plugin `.mcp.json` | AGENTS.md + `.goosehints` (`CONTEXT_FILE_NAMES`); skills in `.agents/skills` (+ `.claude/skills`) |

Notes outside this slice, for the cross-agent-standard section:
- Goose implements the **Open Plugins hooks spec** (https://open-plugins.com/agent-builders/components/hooks), with plugin discovery in `.agents/plugins/`.
- Qwen Code natively loads **Agent Plugins v1** (https://agent-plugins.org/, `$schema` `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`), but that spec carries skills and MCP only; hooks are ignored.
- Kiro and Qwen both speak ACP.
