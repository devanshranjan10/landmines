### Google Antigravity (App, IDE, and Antigravity CLI `agy`)

1. **Pre-edit hook: YES.** Events: `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`. There is no `BeforeTool` alias; Antigravity uses Claude-style names, not Gemini CLI's names. One schema covers the App, CLI and IDE. [VERIFIED-DOCS] https://antigravity.google/docs/hooks?tab=cli
2. **Config locations.** Workspace: `.agents/hooks.json`. Global: `~/.gemini/config/hooks.json`. The CLI also reads `~/.gemini/antigravity-cli/settings.json`, and plugins can ship a `hooks.json`. Use `/hooks` in the CLI, or Settings > Customizations > Hooks in the App and IDE. The **top level is keyed by hook name, then by event**, which differs from Claude's shape: [VERIFIED-DOCS] same URL
   ```json
   { "landmine": { "PreToolUse": [ { "matcher": "write_to_file|replace_file_content|multi_replace_file_content",
       "hooks": [ { "type": "command", "command": "landmine hook --agent antigravity", "timeout": 10 } ] } ] } }
   ```
   - `matcher` is a regex and applies only to Pre/PostToolUse.
   - `timeout` defaults to 30 s.
   - Each named hook has an `enabled: true|false` field.
3. **Stdin payload (camelCase).**
   - Common fields: `conversationId` (this is the session id), `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`.
   - Tool events add `toolCall.name`, `toolCall.args` and `stepIdx`. PostToolUse also has `error`.
   - There is **no `cwd` field**; use `workspacePaths`.
   - Edit tools and their args:
     - `write_to_file`: `TargetFile`, `Overwrite`, `CodeContent`, `Description`, `IsArtifact`, `ArtifactMetadata`
     - `replace_file_content`: `TargetFile`, `Instruction`, `Description`, `AllowMultiple`, `TargetContent`, `ReplacementContent`, `StartLine`, `EndLine`, `TargetLintErrorIds`
     - `multi_replace_file_content`: `TargetFile`, `Instruction`, `Description`, `ReplacementChunks`, `TargetLintErrorIds`, `ArtifactMetadata`
   - The shell tool is `run_command` (`CommandLine`, `Cwd`). [VERIFIED-DOCS] same URL
4. **Blocking.** The hook writes JSON to stdout.
   - PreToolUse `decision` can be `allow`, `auto_approve`, `deny` ("Hard blocks execution immediately"), `ask`, `force_ask`, or `deny_unless_prior_grant`.
   - Add `reason`, which the docs describe as "The explanation shown to the agent or to you for the decision".
   - `overwrite` shallow-merges new args, and `permissionOverrides` is also available.
   - **Exit-code semantics are not documented**, nor is fail-open vs fail-closed behavior. [VERIFIED-DOCS for the fields; UNVERIFIED that the deny reason reaches the model verbatim]
   - **Context channel:** `injectSteps` (`systemMessage` / `userMessage` / `ephemeralMessage` / `toolCall`) works on `SessionStart`, `PreInvocation` and `PostInvocation`. It is not documented on PostToolUse. A `Stop` hook with `decision: "continue"` injects `reason` as a system message. [VERIFIED-DOCS]
5. **Claude Code hook compatibility.** It is not documented. Event names match Claude's, but the file shape, payload keys and output keys all differ, so landmine needs a separate adapter. The Gemini CLI migration guide (`agy plugin import gemini`) converts extensions, commands and MCP, and says nothing about hooks. [VERIFIED-DOCS] https://antigravity.google/docs/cli/gcli-migration/
6. **Trust.** No trust or approval step for workspace hooks is documented. Hooks can only be toggled on or off. [VERIFIED-DOCS (absence)]
7. **MCP.**
   - Global: `~/.gemini/config/mcp_config.json`. Workspace: `.agents/mcp_config.json`. Shape: `{"mcpServers":{"x":{"command":"…","args":[],"env":{},"cwd":"…"}}}`.
   - Remote servers use `serverUrl`.
   - Unconfigured MCP tools run in "Ask" mode by default.
   - The older `~/.gemini/antigravity/mcp_config.json` path is not mentioned in current docs (only `mcp_oauth_tokens.json` lives there). [VERIFIED-DOCS] https://antigravity.google/docs/mcp
8. **Rules and skills.**
   - `AGENTS.md` or `GEMINI.md` per directory and globally (`~/.gemini/AGENTS.md`, `~/.gemini/config/AGENTS.md`, and others).
   - `.agents/rules/*.md` with `trigger: always_on|glob|model_decision|manual`. The legacy `.agent/rules/` path still works.
   - Skills: `.agents/skills/<name>/SKILL.md` (workspace). Globally they live in `~/.gemini/config/skills/`; for the CLI, `~/.gemini/antigravity-cli/skills/`.
   - No mention of `CLAUDE.md` or `.claude/skills`. [VERIFIED-DOCS] https://antigravity.google/docs/rules , https://antigravity.google/docs/skills

### Freebuff (and Codebuff, which it is built on)

0. **What it is.** Freebuff is the free, ad-supported product line from the Codebuff team (CLI, Desktop, Web, Cloud, Chat).
   - Install with `npm install -g freebuff` (npm `freebuff` 0.2.32, modified 2026-10-20).
   - **The GitHub repo `CodebuffAI/codebuff` now redirects to `CodebuffAI/freebuff`** (13.6k stars, "The free coding agent").
   - The README says "Freebuff is built on Codebuff, the open multi-agent framework". The `codebuff` npm package (1.0.688) still exists. [VERIFIED-SOURCE] https://github.com/CodebuffAI/freebuff (README, commit c7c7af9, 2026-10-21)
1. **Pre-edit hook: NO.** The source has no PreToolUse, hooks.json or permission-hook mechanism.
   - A `run_file_change_hooks` tool exists. In the SDK, which the CLI is built on, it is a **no-op** that returns "File change hooks are not supported in the SDK environment".
   - No `codebuff.json` / `fileChangeHooks` config loader is left in `cli/`, `sdk/` or `common/`. [VERIFIED-SOURCE] `sdk/src/tools/run-file-change-hooks.ts`
   - The only programmable interception points:
     - (a) Custom agents in `.agents/*.ts` with `handleSteps` generators. These control that agent's own steps, not the built-in agent's edits.
     - (b) SDK embedders can pass `overrideTools` to `run()`, which replaces local tool handlers such as `write_file` and `str_replace`. That works only if landmine embeds the SDK, not for stock `freebuff`. [VERIFIED-SOURCE] `sdk/src/run.ts:234`, `docs/agents-and-tools.md`
2. **Config: N/A for hooks.**
   - Agents load from `{cwd}/.agents`, `{cwd}/../.agents` and `~/.agents`.
   - MCP loads from `mcp.json` in those same `.agents` directories. [VERIFIED-SOURCE] `cli/src/utils/local-agent-registry.ts`
3. **Payload: N/A.**
   - Edit tool names: `write_file` {`path`, `instructions`, `content`}, `str_replace` {`path`, `replacements[{oldString,newString,allowMultiple}]`}, `apply_patch` {`operation:{type:create_file|update_file|delete_file, path, diff}`}, and `propose_write_file` / `propose_str_replace`. [VERIFIED-SOURCE] `common/src/templates/initial-agents-dir/types/tools.ts`
4. **Block / context: N/A.** No pre-edit block exists. The only fallbacks are an MCP tool or the instruction files.
5. **Claude Code hook compatibility:** none. **Claude compatibility in general:** it reads `CLAUDE.md` and `.claude/skills`. [VERIFIED-SOURCE]
6. **Trust.** Repo-scoped `.agents` directories containing `.ts`/`.js` agents or an `mcp.json` need one-time per-directory trust. Trust is stored in `<configDir>/trusted-agent-dirs.json`. Non-interactive runs skip untrusted directories unless `CODEBUFF_TRUST_AGENT_DIRS=1` or `--trust-agents` is set. Skills-only directories and `~/.agents` need no trust. [VERIFIED-SOURCE] `cli/src/utils/agent-dir-trust.ts`
7. **MCP: YES.** `.agents/mcp.json` (project, or parent for monorepos) or `~/.agents/mcp.json`. Shape: `{"mcpServers":{"x":{"type":"stdio","command":"…","args":[],"env":{"K":"$VAR"}}}}`. These servers are merged into every agent whose id starts with `base`. [VERIFIED-SOURCE] `common/src/types/mcp.ts`, `cli/src/utils/local-agent-registry.ts:376-392`
8. **Rules and skills.**
   - Instruction files: `AGENTS.md` (preferred over `CLAUDE.md`), `*.knowledge.md`, and home-directory `~/.knowledge.md`, `~/.AGENTS.md`, `~/.CLAUDE.md`.
   - Skills: `.agents/skills/`, `~/.agents/skills/`, `.claude/skills/`, and optionally `~/.claude/skills/`. [VERIFIED-SOURCE] `common/src/constants/knowledge.ts`, `sdk/src/run-state.ts`, `sdk/src/skills/load-skills.ts`

### Amp (ampcode.com, formerly Sourcegraph)

1. **Pre-edit hook: YES, as an in-process TypeScript/JavaScript plugin (run with Bun). It is not a shell-command hook.**
   - Events: `session.start`, `agent.start`, `tool.call` ("fires before a tool runs"), `tool.result`, `agent.end`, `changes.prompt`.
   - The old JSON-settings permission system (`amp.permissions` with a `delegate` action) is now "legacy". The Tools doc says: "Amp does not ask for approval before running tools. Use a custom plugin to control tool use." [VERIFIED-DOCS] https://ampcode.com/docs/customize/plugins , https://ampcode.com/docs/tools
   - The status of the legacy `amp.permissions` delegate syntax is UNVERIFIED; the legacy-rules page no longer serves that content.
2. **Plugin locations.** Project: `.amp/plugins/<name>.ts` (or a directory with `index.ts`). System: `$XDG_CONFIG_HOME/amp/plugins/` or `~/.config/amp/plugins/`. Personal and workspace plugins live in Amp-hosted git repos. Name precedence is project > system > personal > workspace. Install with `amp plugins add <url> [--target workspace]` and reload with `plugins: reload`. Minimal example that shells out:
   ```ts
   import type { PluginAPI } from '@ampcode/plugin'
   export default function (amp: PluginAPI) {
     amp.on('tool.call', async (event, ctx) => {
       const files = amp.helpers.filesModifiedByToolCall(event)   // URI[] | null
       if (!files) return { action: 'allow' }
       const r = await ctx.$`landmine check --agent amp ${files.map(amp.helpers.filePathFromURI).join(' ')}`.nothrow?.()
       return r && r.exitCode === 2 ? { action: 'reject-and-continue', message: String(r.stderr) } : { action: 'allow' }
     })
   }
   ```
   The exact return shape of the `ctx.$` shell helper is UNVERIFIED; `$: ShellFunction` is declared. [VERIFIED-DOCS for locations and the event]
3. **Event args.**
   - `ToolCallEvent` = `{ toolUseID: string; tool: string; input: Record<string, unknown>; thread: { id } }`.
   - There is no cwd field; the workspace root is on `ctx.system.workspaceRoot` (URI | null).
   - Helper `filesModifiedByToolCall(event)` "Supports edit/create/apply_patch tools and sed in-place shell commands".
   - Built-in edit tools: `edit_file`, `create_file`, `undo_edit`, plus `apply_patch` for GPT models. Shell tools are `Bash` and `shell_command`. [VERIFIED-SOURCE] `@ampcode/plugin` 0.0.0-20261021001728 `index.d.ts` lines 1708-1745, https://ampcode.com/docs/cli/streaming-json
   - The per-tool input field names (e.g. `path` / `old_str` / `new_str` / `content`) are UNVERIFIED.
4. **Blocking.** `tool.call` returns one of:
   - `{action:'reject-and-continue', message}`: the model sees `message`.
   - `allow`
   - `modify` (with new input)
   - `synthesize` (fake result)
   - `error` (stops the thread worker)

   **Context channels:**
   - `agent.start` can return `{message:{content, display?:false}}` to append hidden text to the user turn.
   - `tool.result` can rewrite the tool output, which is an effective post-edit feedback channel.
   - `agent.end` can return `{action:'continue', userMessage}`.
   - `ctx.ui.confirm` prompts the human. [VERIFIED-SOURCE] same `index.d.ts`
5. **Claude Code hook compatibility: NO.** Amp does not read Claude hooks. It does read Claude **skills** (`.claude/skills`, `~/.claude/skills`, `~/.claude/plugins/cache/`), and it falls back to `CLAUDE.md`/`AGENT.md` when no `AGENTS.md` exists. [VERIFIED-DOCS] https://ampcode.com/docs/customize/skills , https://ampcode.com/docs/customize/agents-md
6. **Trust.** The docs only say "only load plugins you trust". No approval gate for project `.amp/plugins` is documented (UNVERIFIED either way). Workspace MCP servers in `.amp/settings.json` **do** need `amp mcp approve <name>`. [VERIFIED-DOCS] https://ampcode.com/docs/customize/mcp
7. **MCP.** `amp.mcpServers` goes in `~/.config/amp/settings.json` or the workspace `.amp/settings.json`:
   ```json
   "amp.mcpServers": {"landmine": {"command": "landmine", "args": ["mcp"], "env": {}}}
   ```
   `amp mcp add name -- cmd args` also works. Amp recommends bundling MCP in a skill's `mcp.json` instead. [VERIFIED-DOCS] https://ampcode.com/docs/customize/mcp , https://ampcode.com/docs/cli/settings
8. **Rules and skills.**
   - `AGENTS.md`: the current directory, its parents up to `$HOME`, and subtree files that get included when files are read. Also `~/.config/amp/AGENTS.md`, `~/.config/AGENTS.md`, and `/etc/ampcode/AGENTS.md`. Glob-scoped guidance is possible through @-mentioned files with `globs:` frontmatter.
   - Skills: `.agents/skills/`, `~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`, the `.claude/*` paths above, and `amp.skills.path`. [VERIFIED-DOCS]

### Factory Droid (docs.factory.ai now redirects 308 to docs.factory.com)

1. **Pre-edit hook: YES.** Events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`. These are Claude Code's event names. [VERIFIED-DOCS] https://docs.factory.com/reference/hooks-reference (raw: https://docs.factory.com/harness/hooks.md)
2. **Config locations.**
   - User: `~/.factory/hooks.json`. Project: `.factory/hooks.json`.
   - Legacy: `.factory/hooks/hooks.json`. Fallback: the `hooks` key in `~/.factory/settings.json` or `.factory/settings.json`.
   - Org-managed hooks also exist.
   - Standalone `hooks.json` is keyed **directly by event**, with no `hooks` wrapper. Commands are `type: "command"` only, and `timeout` defaults to 60 s.
   - Matchers are case-sensitive regexes, and there is an extra `commandRegex` for `Execute`.
   ```json
   {"PreToolUse":[{"matcher":"Create|Edit|ApplyPatch","hooks":[{"type":"command","command":"landmine hook --agent droid","timeout":30}]}]}
   ```
   [VERIFIED-DOCS]
3. **Stdin payload.** Fields: `session_id`, `transcript_path`, `cwd`, `permission_mode` (`off|spec|auto-low|auto-medium|auto-high`), `hook_event_name`, optional `message_id`, `tool_name`, `tool_input`.
   - Edit and write tools: `Create` (`tool_input.file_path`, `tool_input.content`), `Edit` (`tool_input.file_path` per the official guide), `ApplyPatch`.
   - There is no `MultiEdit`. The shell tool is `Execute`; MCP tools are `mcp__<server>__<tool>`.
   - Common fields are also exported as environment variables, and `$FACTORY_PROJECT_DIR` is available. [VERIFIED-DOCS] hooks reference; https://github.com/Factory-AI/factory/blob/main/docs/guides/hooks/code-validation.mdx
   - `Edit`'s old/new string field names and the `ApplyPatch` input shape are UNVERIFIED.
4. **Blocking.** Either exit `2` with the reason on stderr ("PreToolUse blocks the tool call"), or JSON `hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason` ("Blocks the tool call and sends the reason to Droid").
   - Also `allow` / `ask`, `updatedInput`, `continue:false` / `stopReason`, and `suppressOutput`.
   - **Context:** `PostToolUse` supports `decision:"block"` + `reason` and `hookSpecificOutput.additionalContext`. `SessionStart` supports `additionalContext`, and `UserPromptSubmit` supports top-level `additionalContext`.
   - PreToolUse has no documented `additionalContext`. [VERIFIED-DOCS]
5. **Claude Code compatibility: near drop-in for the hook protocol, but there is no automatic import of `.claude/settings.json` hooks.**
   - Event names, stdin fields and output JSON are Claude-identical. The differences are the tool names (`Execute`/`Create`/`ApplyPatch` vs `Bash`/`Write`) and the file layout.
   - Claude Code **plugins** install natively: `.claude-plugin/` is renamed to `.factory-plugin/`, `hooks/hooks.json` is loaded, and `${CLAUDE_PLUGIN_ROOT}` is expanded.
   - The `/skills` and `/droids` menus offer "Import from Claude". [VERIFIED-DOCS] https://docs.factory.com/harness/plugins.md , https://docs.factory.com/harness/subagents.md
6. **Trust.** No per-hook trust prompt.
   - "Droid snapshots hooks at startup and warns when hooks are modified externally".
   - `hooksDisabled` turns all hooks off globally. With enterprise `allowManagedHooksOnly: true`, user and project hooks are ignored.
   - MCP tool approvals are fingerprinted by command and URL. [VERIFIED-DOCS]
7. **MCP.** `~/.factory/mcp.json` (user), `.factory/mcp.json` (project, or an ancestor folder). Shape: `{"mcpServers":{"x":{"type":"stdio","command":"npx","args":[...],"env":{},"disabled":false}}}`. `${VAR}` expansion is supported, as are `enabledTools`/`disabledTools`. Config reloads when the file changes. [VERIFIED-DOCS] https://docs.factory.com/harness/mcp.md
8. **Rules and skills.**
   - Instruction files: `AGENTS.md`, plus `agents.md`, `Agents.md`, `CLAUDE.md`, `Claude.md`.
   - Skills: `.factory/skills/<n>/SKILL.md`, `~/.factory/skills/`, `.agents/skills/**`, `.agent/skills/**`, `~/.agents/skills/**`, and plugin skills. [VERIFIED-DOCS] https://docs.factory.com/harness/agents-md.md , https://docs.factory.com/harness/skills.md

#### Table rows
| agent | pre-edit hook? | block mechanism | context channel | config path | MCP | rules/skills |
|---|---|---|---|---|---|---|
| Google Antigravity (App/IDE/`agy` CLI) | YES: `PreToolUse` (matcher regex over `write_to_file`/`replace_file_content`/`multi_replace_file_content`) | stdout JSON `{"decision":"deny","reason":…}` (exit codes undocumented) | `injectSteps` on SessionStart/Pre/PostInvocation; Stop `decision:"continue"` + reason | `.agents/hooks.json`, `~/.gemini/config/hooks.json` (keyed by hook name, then event) | `.agents/mcp_config.json`, `~/.gemini/config/mcp_config.json` | AGENTS.md/GEMINI.md, `.agents/rules/*.md`, `.agents/skills/*/SKILL.md` |
| Freebuff / Codebuff | NO (`run_file_change_hooks` is a no-op; SDK-only `overrideTools`) | n/a | n/a | n/a (`.agents/` holds agents and mcp.json) | `.agents/mcp.json`, `~/.agents/mcp.json` (trust-gated) | AGENTS.md > CLAUDE.md, `*.knowledge.md`; `.agents/skills`, `.claude/skills` |
| Amp | YES, in-process TS plugin `amp.on('tool.call')` (no shell hook) | return `{action:'reject-and-continue', message}` | `agent.start` → `{message}`; `tool.result` rewrite; `agent.end` continue | `.amp/plugins/*.ts`, `~/.config/amp/plugins/` | `amp.mcpServers` in `.amp/settings.json` (needs `amp mcp approve`) / `~/.config/amp/settings.json` | AGENTS.md (CLAUDE.md fallback); `.agents/skills`, `.claude/skills` |
| Factory Droid | YES: `PreToolUse` (matcher `Create\|Edit\|ApplyPatch`) | exit 2 + stderr, or `hookSpecificOutput.permissionDecision:"deny"` + `permissionDecisionReason` | PostToolUse `additionalContext` / `decision:block`; SessionStart/UserPromptSubmit `additionalContext` | `.factory/hooks.json`, `~/.factory/hooks.json` (or `hooks` in settings.json) | `.factory/mcp.json`, `~/.factory/mcp.json` | AGENTS.md/CLAUDE.md; `.factory/skills`, `.agents/skills` |
