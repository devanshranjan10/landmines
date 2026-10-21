## GitHub Copilot (3 surfaces) and Windsurf / Cascade

Research date 2026-10-21. Source of truth = microsoft/vscode `main` (the Copilot Chat extension now lives in-tree at `extensions/copilot/`), github/copilot-cli changelog/issues, docs.github.com, code.visualstudio.com, docs.devin.ai (Windsurf docs now redirect there).

### GitHub Copilot: VS Code agent mode ("Local" harness)

1. **Pre-edit hook: YES.** `PreToolUse` fires before every tool call, edit tools included. Local-harness events are `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SubagentStart, SubagentStop, Stop`. VERIFIED-SOURCE: `HOOKS_BY_TARGET[Target.VSCode]` in https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/promptSyntax/hookTypes.ts. The feature is still labeled "Preview" (VERIFIED-DOCS https://code.visualstudio.com/docs/agent-customization/hooks).
   - VS Code also has other session harnesses: Copilot (uses the Copilot CLI/SDK hook implementation, see the next section), Claude (Claude Agent SDK, which runs native Claude hooks), Codex, and Cloud. Everything below covers the Local harness. VERIFIED-DOCS, same URL.
2. **Config.**
   - Default locations: `.github/hooks/*.json` (workspace), `.claude/settings.local.json`, `.claude/settings.json`, `~/.copilot/hooks/*.json` (user), and `~/.claude/settings.json`. VERIFIED-SOURCE: `DEFAULT_HOOK_FILE_PATHS` in https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/promptSyntax/config/promptFileLocations.ts (L212-218).
   - Other locations: `hooks:` in the frontmatter of a custom agent `.agent.md`, and plugin `hooks.json` or `hooks/hooks.json`. VERIFIED-DOCS https://code.visualstudio.com/docs/copilot/customization/hooks.
   - Settings: `chat.useHooks` (default true; org policy `ChatHooks`), `chat.hookFilesLocations`, and `chat.useClaudeHooks` (default **false**). VERIFIED-SOURCE https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts.
   - Command fields: `type:"command"`, `command`, `windows`, `linux`, `osx`, `cwd`, `env`, and `timeout` (seconds, default 30). Copilot CLI-style `bash`, `powershell` and `timeoutSec` are accepted and normalized. VERIFIED-SOURCE `hookSchema.ts`, `extensions/copilot/src/platform/chat/node/hookExecutor.ts`.
   - **Matchers are ignored.** `extractHookCommandsFromItem` discards `matcher`, so every PreToolUse hook runs for every tool and your script must filter on `tool_name`. VERIFIED-SOURCE `hookSchema.ts` L514-555. The docs say the same for Claude files (VERIFIED-DOCS).
   - Minimal example, `.github/hooks/landmine.json`:
     ```json
     {"hooks":{"PreToolUse":[{"type":"command","command":"landmine hook --agent vscode","timeout":15}]}}
     ```
3. **Stdin payload** is snake_case regardless of the file's format. VERIFIED-SOURCE `extensions/copilot/src/extension/chat/vscode-node/chatHookService.ts` L127-153 and L350-354.
   - Common fields: `timestamp` (ISO), `hook_event_name`, `session_id`, `transcript_path`, and `cwd` (the hook's cwd, which defaults to the workspace root).
   - PreToolUse fields: `tool_name`, `tool_input` (object), and `tool_use_id`.
   - `tool_name` is the model-facing name (`props.toolCall.name`). VERIFIED-SOURCE `extensions/copilot/src/extension/prompts/node/panel/toolCalling.tsx` L300-305. **Claude names (`Edit`/`Write`) are NOT mapped** (no mapping code exists in `chatHookService.ts` or `hookCompatibility.ts`).
   - Edit tools and their `tool_input` shapes (VERIFIED-SOURCE `extensions/copilot/src/extension/tools/common/toolNames.ts` plus the `languageModelTools` input schemas in `extensions/copilot/package.json`):
     - `replace_string_in_file`: `{filePath, oldString, newString}`
     - `multi_replace_string_in_file`: `{explanation, replacements:[{filePath, oldString, newString}]}`
     - `create_file`: `{filePath, content}`
     - `insert_edit_into_file`: `{filePath, code, explanation}`. `code` is a sketch with "...existing code..." markers, not the final file.
     - `apply_patch`: `{input, explanation}`. `input` is a V4A-style patch text that can touch several files.
     - `edit_notebook_file`: `{filePath, cellId, editType, ...}`
     - `create_directory`
   - Post-event payloads: PostToolUse adds `tool_response`. Stop adds `stop_hook_active`. VERIFIED-DOCS https://code.visualstudio.com/docs/agents/reference/hooks-reference.
4. **Blocking.**
   - Exit 2 is a deny, and stderr becomes the reason. Exit 0 parses stdout as JSON. Any other exit code is a non-blocking warning. VERIFIED-SOURCE `hookExecutor.ts` L139-161 and `chatHookService.ts` "Exit code 2 (error) means deny the tool".
   - JSON alternative: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"|"ask"|"allow","permissionDecisionReason":"...","updatedInput":{...},"additionalContext":"..."}}`.
     - When several hooks answer, the most restrictive decision wins (deny > ask > allow), and all deny reasons are joined.
     - `updatedInput` is validated against the tool schema.
   - What the model sees on a deny: a tool result of `"Tool execution denied: <reason>"` with `toolResultError`. VERIFIED-SOURCE https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts L430-458.
   - Context without blocking: PreToolUse `additionalContext` is appended to the tool result as `<PreToolUse-context>...</PreToolUse-context>` (`toolCalling.tsx` L643-647). PostToolUse `decision:"block"` + `reason` or `additionalContext` are appended as `<PostToolUse-context>`.
   - Top-level `continue:false` / `stopReason` stops the run. `systemMessage` is a warning for the user only. VERIFIED-SOURCE `chatHookService.ts` L289-337.
   - Timeout is 30 s by default, then SIGTERM and SIGKILL. A timeout is treated as a non-blocking error (fail-open). VERIFIED-SOURCE `hookExecutor.ts`.
5. **Claude Code hooks: PARTIAL.**
   - VS Code reads `.claude/settings{,.local}.json` and `~/.claude/settings.json`, but only when `chat.useClaudeHooks=true` (off by default). Nested `{matcher, hooks:[...]}` entries and `disableAllHooks` are parsed.
   - Matchers are dropped, the payload uses VS Code tool names and arguments (`replace_string_in_file`/`filePath`, not `Edit`/`file_path`), and the output JSON (`hookSpecificOutput.permissionDecision`) is Claude-compatible.
   - Net effect: a Claude-format landmine hook can block in VS Code, but it must recognize VS Code tool names. VERIFIED-SOURCE `hookClaudeCompat.ts`, `hookCompatibility.ts`, `chatHookService.ts`.
6. **Trust.**
   - Workspace hook files are subject to Workspace Trust. Agent-scoped hooks need `chat.useHooks` and a trusted workspace. VERIFIED-DOCS https://code.visualstudio.com/docs/copilot/customization/hooks.
   - The hook settings are `restricted: true` (ignored from workspace settings in untrusted workspaces) and `chat.useHooks` can be disabled by org policy. VERIFIED-SOURCE `chat.shared.contribution.ts`.
   - There is no per-hook approval prompt (UNVERIFIED as an absence).
7. **MCP.**
   - Legacy format: `.vscode/mcp.json` with a top-level `servers` (`{"servers":{"landmine":{"type":"stdio","command":"landmine","args":["mcp"]}}}`), plus a user-profile `mcp.json`. Both are now labeled "deprecated" in the guided flow.
   - New default for personal servers: `~/.copilot/mcp-config.json` (`$COPILOT_HOME`), using the portable `mcpServers` format shared with Copilot CLI.
   - A workspace-root `.mcp.json` sits behind the experimental `chat.mcp.workspaceRootConfig.enabled`.
   - All VERIFIED-DOCS https://code.visualstudio.com/docs/copilot/customization/mcp-servers. The exact `servers` stdio shape is from my prior knowledge and UNVERIFIED on today's page.
8. **Rules and skills.** VERIFIED-SOURCE `promptFileLocations.ts` L172-205 and `config.ts`, `chat.shared.contribution.ts`.
   - Rules: `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` (with `applyTo` globs), and `~/.copilot/instructions`.
   - `AGENTS.md`: `chat.useAgentsMdFile` default true. Nested AGENTS.md: `chat.useNestedAgentsMdFiles` default false.
   - `CLAUDE.md`: `chat.useClaudeMdFile` default true.
   - Skills (`SKILL.md`, `chat.useAgentSkills` default true) are loaded from `.agents/skills`, `.github/skills`, `.claude/skills`, `~/.agents/skills`, `~/.copilot/skills` and `~/.claude/skills`.
   - **Diagnostics feedback channel:**
     - After `replace_string_in_file`, `create_file` and related tools, the edit result appends "The edit resulted in the following lint errors:" with up to 20 *new* Error or Warning diagnostics from `ILanguageDiagnosticsService`. It waits `diagnosticsTimeout` (default 1000 ms) and diffs against the diagnostics present before the edit. That covers any LSP or extension diagnostic provider.
     - This is gated by `github.copilot.chat.agent.autoFix`: default false, tagged `onExp` (experiment-controlled). VERIFIED-SOURCE `extensions/copilot/src/extension/tools/node/editFileToolResult.tsx` L79-143 and `extensions/copilot/src/platform/configuration/common/configurationService.ts` L1168.
     - The model can also call `get_errors` (`copilot_getErrors`, reference `#problems`, input `{filePaths?}`) at any time. VERIFIED-SOURCE `toolNames.ts` and `package.json`.

### GitHub Copilot CLI (`@github/copilot`, latest npm 1.0.101 on 2026-10-21)

1. **Pre-edit hook: YES.**
   - camelCase events: `preToolUse`, `postToolUse`, `postToolUseFailure`, `permissionRequest`, `preMcpToolCall`, `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `userPromptTransformed`, `agentStop`, `subagentStart`, `subagentStop`, `preCompact`, `errorOccurred`, `notification`.
   - The PascalCase aliases (`PreToolUse`, ...) switch the payload to snake_case.
   - Edit tool names: `edit` (also `str_replace_editor`, `apply_patch`) and `create`. There is no `write` tool.
   - VERIFIED-DOCS https://docs.github.com/en/copilot/reference/hooks-reference. The event list is also VERIFIED-SOURCE in `copilotAgentHookMetadata`, `hookTypes.ts` in microsoft/vscode.
2. **Config.**
   - Locations:
     - Policy: `/etc/github-copilot/policy.d/*.json` (root-owned, cannot be disabled).
     - Repo: `.github/hooks/*.json`.
     - User: `~/.copilot/hooks/*.json` (`$COPILOT_HOME/hooks`).
     - Inline `hooks` in `.github/copilot/settings.json`, `.github/copilot/settings.local.json` and `~/.copilot/settings.json`.
     - Repo `.claude/settings.json` and `.claude/settings.local.json`.
     - Plugin `hooks.json`.
     - `~/.copilot/config.json` is no longer read for hooks.
   - Loading behavior: all sources run, and changes load at CLI start. VERIFIED-DOCS hooks-reference and https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks.
   - Entry fields: `type` (`command`, `http`, or `prompt`), `matcher` (regex anchored `^(?:...)$`, applied to `toolName`), `bash`, `powershell`, `command`, `exec`+`args`, `cwd`, `env`, and `timeoutSec` (default 30). VERIFIED-DOCS.
   - Minimal example, `.github/hooks/landmine.json`:
     ```json
     {"version":1,"hooks":{"preToolUse":[{"type":"command","matcher":"edit|create|apply_patch|str_replace_editor","bash":"landmine hook --agent copilot","timeoutSec":15}]}}
     ```
3. **Stdin payload.**
   - camelCase format: `{sessionId, timestamp(ms number), cwd, toolName, toolArgs}`. `toolArgs` is typed `unknown` but in practice arrives as a **JSON-encoded string** (the docs' own test sample is `"toolArgs":"{\"command\":\"ls\"}"`). VERIFIED-DOCS use-hooks page; corroborated by OPEN issue https://github.com/github/copilot-cli/issues/3349.
   - PascalCase format: `{hook_event_name, session_id, timestamp(ISO), cwd, tool_name, tool_input}`. `tool_input` is "parsed from JSON string when possible", `tool_name` is the Claude name (`edit`/`apply_patch` become `Edit`, `create` becomes `Write`), and there is no `tool_use_id`. VERIFIED-DOCS hooks-reference.
   - Argument names: `create` takes `path` and `file_text`. UNVERIFIED: only seen in user issue https://github.com/github/copilot-cli/issues/4626.
   - `edit` presumably takes `path`, `old_str`, `new_str`. UNVERIFIED: not documented and the binary is compressed.
   - Whether PascalCase `tool_input` is renamed to Claude argument keys: UNVERIFIED (the docs only say tool *names* are mapped).
4. **Blocking.**
   - Stdout JSON: `{"permissionDecision":"deny","permissionDecisionReason":"..."}`. The reason is "shown to the agent" and required with deny. `"ask"` becomes a deny in cloud agent and autopilot. `modifiedArgs` (alias `updatedInput`) rewrites the tool arguments.
   - Exit 2 = deny, even if stdout says allow.
   - preToolUse is **fail-closed** on other non-zero exits ("Denied by preToolUse hook (hook errored)") but **fail-open on timeout**. VERIFIED-DOCS hooks-reference; changelog L871 and L1509 in https://github.com/github/copilot-cli/blob/main/changelog.md.
   - Context channel: `additionalContext` works on postToolUse (injected for the model), sessionStart, subagentStart and userPromptSubmitted.
   - For preToolUse the docs omit `additionalContext`, but changelog L2057 says "preToolUse hooks now respect modifiedArgs/updatedInput, and additionalContext fields". This is CONFLICTING; treat it as UNVERIFIED.
5. **Claude Code hooks: YES, largely.**
   - It reads the repo `.claude/settings.json` and `.claude/settings.local.json` (not `~/.claude`), accepts PascalCase event names, nested `{matcher, hooks:[]}` and an optional `type`, and sends Claude tool names in the PascalCase payload. VERIFIED-DOCS hooks-reference; changelog L2358, L2370, L1354.
   - Plugin hooks get `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PROJECT_DIR`. VERIFIED-SOURCE changelog L2025, L2228.
   - Known bug: `.claude` hooks run through PowerShell on Windows. https://github.com/github/copilot-cli/issues/4001
6. **Trust.**
   - Repo hooks load only after folder trust is confirmed ("workspace admission"). VERIFIED-DOCS hooks-reference; changelog L2310.
   - In `-p` prompt mode, repo hooks need `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS` unless the folder is already trusted. Changelog L1839, L1679.
   - With the sandbox on, repo, user and plugin hooks run inside the sandbox, while policy hooks run on the host. VERIFIED-DOCS.
7. **MCP.** VERIFIED-DOCS https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers.
   - Locations: `~/.copilot/mcp-config.json` (user), plus workspace `.mcp.json` or `.github/mcp.json` (`.mcp.json` wins). `.vscode/mcp.json` support was removed (changelog L2087).
   - Shape: `{"mcpServers":{"landmine":{"type":"local","command":"landmine","args":["mcp"],"env":{},"tools":["*"]}}}`.
   - Project MCP loads only after folder trust.
8. **Rules and skills.**
   - Instruction files: `AGENTS.md`, `CLAUDE.md` (and `.claude/CLAUDE.md`), `GEMINI.md`, `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `~/.copilot/copilot-instructions.md`, `~/.copilot/instructions/**`, and `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`. VERIFIED-DOCS https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions.
   - Skills: `.github/skills`, `.claude/skills`, `.agents/skills`, `~/.copilot/skills`, `~/.agents/skills`. VERIFIED-DOCS https://docs.github.com/en/copilot/concepts/agents/about-agent-skills.
   - The CLI has an LSP tool (`lsp.json`/`.lsp.json`) for code intelligence. Whether diagnostics are pushed to the model automatically after edits is UNVERIFIED.

### GitHub Copilot cloud agent (formerly "coding agent")

1. **Pre-edit hook: YES.** It uses the same SDK hook engine as the CLI but only a subset of events: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred` (plus `agentStop` and `subagentStop` per the concept page). VERIFIED-DOCS https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/use-hooks and https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks.
2. **Config:** **only** `.github/hooks/*.json`, and it **must be on the default branch**. There are no user files, settings.json, `.claude` files or plugins. VERIFIED-DOCS, both pages plus hooks-reference. Same JSON shape as the CLI.
3. **Payload:** same as the CLI (`toolName`/`toolArgs`). It runs in an ephemeral Linux sandbox. Hook env vars are `GITHUB_COPILOT_API_TOKEN`, `GITHUB_COPILOT_GIT_TOKEN` and `COPILOT_AGENT_PROMPT`. VERIFIED-DOCS hooks-reference.
4. **Blocking:** `permissionDecision:"deny"` plus a reason, or exit 2. **`"ask"` is treated as deny.** VERIFIED-DOCS hooks-reference.
5. **Claude Code hooks: NO.** `.claude/settings.json` is not read. VERIFIED-DOCS hooks-reference: "the only hook configuration that exists by default is `.github/hooks/*.json`".
6. **Trust:** being committed to the default branch acts as the trust gate. There is no interactive approval. UNVERIFIED as stated policy; the docs say nothing explicit.
7. **MCP:** configured in repo **Settings > Copilot > MCP servers** (UI JSON, not a file). Example: `{"mcpServers":{"x":{"type":"local","command":"...","args":[],"tools":["..."],"env":{"K":"$COPILOT_MCP_K"}}}}`. `tools` is required, secrets must be prefixed `COPILOT_MCP_`, and tools run **without approval**. VERIFIED-DOCS https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/extend-cloud-agent-with-mcp.
8. **Rules and skills:** AGENTS.md, copilot-instructions and skills are supported. Skill support is VERIFIED-DOCS (about-agent-skills lists "Copilot cloud agent"). The exact instruction-file list for cloud agent is UNVERIFIED in this pass.

### Windsurf / Cascade (now branded "Devin Desktop"; docs.windsurf.com 307-redirects to docs.devin.ai/desktop)

1. **Pre-edit hook: YES**, `pre_write_code`.
   - All 12 events: `pre_read_code`, `post_read_code`, `pre_write_code`, `post_write_code`, `pre_run_command`, `post_run_command`, `pre_mcp_tool_use`, `post_mcp_tool_use`, `pre_user_prompt`, `post_cascade_response`, `post_cascade_response_with_transcript`, `post_setup_worktree`. VERIFIED-DOCS https://docs.devin.ai/desktop/cascade/hooks.
   - These are "Cascade hooks". The new **Devin Local** agent inside Devin Desktop uses the *Devin CLI* lifecycle hooks instead, documented at https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks.
     - Claude-like events: `PreToolUse`, `PostToolUse`, `PermissionRequest`, ...
     - Entry format: `{matcher, hooks:[{type:"command"}]}`. Payload: `tool_name`, `tool_input`, `session_id`.
     - File tools are `write`, `edit` and `apply_patch`. Config paths are not stated.
     - VERIFIED-DOCS for those facts. Whether this applies to Devin Local in the desktop app is UNVERIFIED.
2. **Config.** All locations are merged, loaded in order cloud > system > user > workspace. VERIFIED-DOCS.
   - System: `/Library/Application Support/Devin/hooks.json`, `/etc/devin/hooks.json`, `C:\ProgramData\Devin\hooks.json`. Legacy Windsurf paths are used if no Devin file exists.
   - User: `~/.codeium/windsurf/hooks.json`. The JetBrains plugin uses `~/.codeium/hooks.json`.
   - Workspace: `.devin/hooks.json`. Legacy `.windsurf/hooks.json` is used only if the `.devin` file is absent or empty.
   - Enterprise: cloud dashboard.
   - Minimal example:
     ```json
     {"hooks":{"pre_write_code":[{"command":"landmine hook --agent windsurf","show_output":true}]}}
     ```
     Fields: `command` (run with `bash -c`), `powershell`, `show_output`, and `working_directory` (default the workspace root, with no `~` expansion).
3. **Stdin payload** (VERIFIED-DOCS): common fields `agent_action_name`, `trajectory_id` (the conversation), `execution_id` (the turn), `timestamp`, `model_name`, `tool_info`.
   - `pre_write_code` `tool_info`: `{file_path, edits:[{old_string,new_string}]}`.
   - There is no session cwd field for write hooks. `pre_run_command` has `tool_info.cwd` and `command_line`.
4. **Blocking:** **exit 2** blocks (pre-hooks only) and "The Cascade agent will see the error message from stderr". Any other exit code proceeds. There is **no JSON output channel and no additional-context channel**. Stdout only reaches the user when `show_output:true`. VERIFIED-DOCS.
5. **Claude Code hooks: NO** for Cascade (not mentioned). There is a "Claude Code config reading" option, but it is documented only for scanning `.claude/skills`. VERIFIED-DOCS https://docs.devin.ai/desktop/cascade/skills.
6. **Trust:** hooks don't load in Restricted Mode, and there is no per-hook approval. System hooks can't be disabled without root. VERIFIED-DOCS.
7. **MCP:** `~/.config/devin/mcp_config.json` (`$XDG_CONFIG_HOME`; Windows `%APPDATA%\devin\mcp_config.json`) in the shape `{"mcpServers":{"landmine":{"command":"landmine","args":["mcp"],"env":{}}}}`. It is user-level only, with a 100-tool cap, a `disabledTools` list, and a team allowlist (allowlisting one server blocks all others). VERIFIED-DOCS https://docs.devin.ai/desktop/cascade/mcp. The older path `~/.codeium/windsurf/mcp_config.json` is not on today's page (UNVERIFIED whether it is still read).
8. **Rules and skills.** VERIFIED-DOCS https://docs.devin.ai/desktop/cascade/memories and https://docs.devin.ai/desktop/cascade/skills.
   - Rules: `.devin/rules/*.md`, falling back to `.windsurf/rules/*.md` and legacy `.windsurfrules`, with triggers `always_on`, `glob`, `model_decision` and `manual` (12k chars per file). Global rules: `~/.codeium/windsurf/memories/global_rules.md` (6k).
   - **AGENTS.md** is supported: root-level is always on, and subdirectory files are glob-scoped.
   - **SKILL.md** skills: `.devin/skills`, `.windsurf/skills`, `.agents/skills`, `~/.codeium/windsurf/skills`, `~/.config/devin/skills`, `~/.agents/skills`, plus `.claude/skills` if Claude config reading is enabled.

#### Table rows

| agent | pre-edit hook? | block mechanism | context channel | config path | MCP | rules/skills |
|---|---|---|---|---|---|---|
| Copilot – VS Code agent (Local harness) | YES `PreToolUse` (matchers ignored; tools `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`, `insert_edit_into_file`, `apply_patch`) | exit 2 (stderr) or `hookSpecificOutput.permissionDecision:"deny"` + `permissionDecisionReason`; model gets "Tool execution denied: …" | `additionalContext` (Pre/Post), `<PreToolUse-context>`; post-edit lint diagnostics if `github.copilot.chat.agent.autoFix` | `.github/hooks/*.json`, `~/.copilot/hooks/*.json`, `.claude/settings*.json` (needs `chat.useClaudeHooks`), `.agent.md` frontmatter | `.vscode/mcp.json` (`servers`), now `~/.copilot/mcp-config.json` (`mcpServers`) | AGENTS.md, CLAUDE.md, copilot-instructions, `.instructions.md`; SKILL.md in `.github/.claude/.agents/skills` |
| Copilot CLI | YES `preToolUse`/`PreToolUse` (tools `edit`, `create`, `apply_patch`; Claude-mapped `Edit`/`Write` in PascalCase) | stdout `{"permissionDecision":"deny","permissionDecisionReason":…}` or exit 2; fail-closed on error, fail-open on timeout | postToolUse/sessionStart `additionalContext`; preToolUse `additionalContext` per changelog only | `.github/hooks/*.json`, `~/.copilot/hooks/*.json`, `.github/copilot/settings*.json`, repo `.claude/settings*.json`, policy.d | `~/.copilot/mcp-config.json`, `.mcp.json`, `.github/mcp.json` (`mcpServers`, `type:"local"`) | AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions; SKILL.md |
| Copilot cloud agent | YES `preToolUse` (subset of events) | same as CLI; `ask` = deny | postToolUse `additionalContext` | `.github/hooks/*.json` on default branch only | Repo Settings › Copilot › MCP (UI JSON, `tools` required) | AGENTS.md/instructions; SKILL.md |
| Windsurf / Devin Desktop (Cascade) | YES `pre_write_code` (`tool_info.file_path`, `edits[{old_string,new_string}]`) | exit 2; stderr shown to agent | none (no JSON output) | `.devin/hooks.json` (legacy `.windsurf/hooks.json`), `~/.codeium/windsurf/hooks.json`, system `/Library/Application Support/Devin/hooks.json` | `~/.config/devin/mcp_config.json` (`mcpServers`, user-only) | `.devin/rules` / `.windsurf/rules`, AGENTS.md; SKILL.md in `.devin/.windsurf/.agents/skills` |
