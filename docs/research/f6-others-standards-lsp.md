# F6: Other agents with pre-tool hooks, cross-agent standards, LSP-diagnostics channel

Researched 2026-10-21. Confidence tags: VERIFIED-SOURCE (read in GitHub source), VERIFIED-DOCS (official vendor docs), UNVERIFIED.
Star counts are from `gh api repos/<r>` on 2026-10-21.

---

## Part 1: Other agents that qualify (>5k stars or major vendor, with a pre-tool hook)

### Kimi Code CLI (MoonshotAI/kimi-code, 7.9k stars; it replaces the archived MoonshotAI/kimi-cli, 11.4k stars)
- Status: the old Python `kimi-cli` is archived ("Legacy Python Kimi CLI, no longer maintained. Please use Kimi Code CLI"). VERIFIED-SOURCE https://github.com/MoonshotAI/kimi-cli
- 1. Pre-edit hook: `PreToolUse`, which fires "before a tool call (before permission checks); the tool will not execute if blocked". Matcher is a regex on the tool name. VERIFIED-DOCS https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/hooks.md
- 2. Config: `[[hooks]]` array in `~/.kimi-code/config.toml` (or `$KIMI_CODE_HOME`). Allowed fields are exactly `event`, `matcher`, `command`, `timeout`; extra fields fail config load. There is no project-level hooks file. Plugins (`kimi.plugin.json`) can also declare `hooks`. VERIFIED-DOCS (same URL; plugins.md)
  ```toml
  [[hooks]]
  event = "PreToolUse"
  matcher = "^(Edit|Write)$"
  command = "landmine hook --agent kimi"
  timeout = 10
  ```
- 3. Payload (snake_case): `hook_event_name`, `session_id`, `session_title`, `client_type`, `cwd`, `tool_name`, `tool_input`, `tool_call_id`. VERIFIED-SOURCE (agentExternalHooksService.ts runPreToolUse passes toolName/toolInput/toolCallId; docs say all fields are snake_case). Edit tools: `Edit` takes `{path, old_string, new_string}` and `Write` takes `{path, content}`. Note the field is `path`, not `file_path`. VERIFIED-SOURCE packages/agent-core-v2/src/agent/tools/edit/editTool.ts, tools/os/write/writeTool.ts
- 4. Block: exit `2` uses stderr as the reason. Alternatively, stdout JSON `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"..."}}` (Claude-style). Other non-zero exits and timeouts fail open. Docs say "Kimi Code CLI writes the blocking reason back into the context". Context channel: on exit 0, "stdout content (if any) may be appended to context" (stated for UserPromptSubmit; for PreToolUse allow it is UNVERIFIED). VERIFIED-DOCS + VERIFIED-SOURCE (internal/runHook.ts parses `hookSpecificOutput.permissionDecision`)
- 5. Claude Code hooks: accepts the Claude-style output JSON and exit-2 semantics, but the config is its own TOML. It does not read `.claude/settings.json` (UNVERIFIED negative).
- 6. Trust: no hook trust prompt is documented. Project-level `.kimi-code/mcp.json` stdio entries carry a "only enable in repositories you trust" warning. VERIFIED-DOCS mcp.md
- 7. MCP: `~/.kimi-code/mcp.json` and project `.kimi-code/mcp.json`, shape `{"mcpServers":{"x":{"command":"npx","args":[...],"env":{}}}}`. VERIFIED-DOCS https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/mcp.md
- 8. Rules/skills: `AGENTS.md` (project), `~/.kimi-code/AGENTS.md`, `~/.agents/AGENTS.md`. Skills `SKILL.md` load from `~/.kimi-code/skills/`, `~/.agents/skills/`, `.kimi-code/skills/`, `.agents/skills/`. VERIFIED-DOCS agents.md, skills.md. ACP is supported (`docs/en/reference/kimi-acp.md` exists). VERIFIED-SOURCE

### Mistral Vibe CLI (mistralai/mistral-vibe, 5.2k stars)
- 1. Pre-edit hook: `type = "pre_tool"`, which "fires per tool call, before the user permission prompt. First deny short-circuits." VERIFIED-DOCS https://github.com/mistralai/mistral-vibe/blob/main/README.md (Hooks section)
- 2. Config: `<project>/.vibe/hooks.toml` (project, loaded first, trusted folders only) and `~/.vibe/hooks.toml`. VERIFIED-DOCS + VERIFIED-SOURCE (vibe/core/config/harness_files/_harness_manager.py `hook_files`)
  ```toml
  [[hooks]]
  name = "landmine"
  type = "pre_tool"
  match = "re:^(write_file|edit)$"   # fnmatch glob, or `re:` regex, case-insensitive
  command = "landmine hook --agent vibe"
  timeout = 10
  strict = false                     # true = failures become denials (fail closed)
  ```
- 3. Payload: `hook_event_name: "pre_tool"`, `session_id`, `parent_session_id`, `transcript_path`, `cwd`, `tool_name`, `tool_call_id`, `tool_input`. The hook-visible `tool_name` is qualified (`file_system.write_file`, `file_system.search_replace`). `match` also accepts the model names `write_file` and `edit`. `tool_input` is translated to the legacy shape: write_file gets `file_path` and `content`; search_replace gets `old_string`, `new_string`, `replace_all`. VERIFIED-SOURCE harness/.../vibe/_foreign_hooks.py (`_stdin_payload`, `_AUTHOR_ARGUMENTS`), _hook_matcher.py (`_BUILTIN_MODEL_NAMES`)
- 4. Block: exit 0 plus stdout `{"decision":"deny","reason":"..."}`, where the reason "becomes the tool error the LLM sees". Any non-zero exit, timeout, or bad JSON counts as a hook failure: a warning, or a deny if `strict = true`. Exit 2 has no special meaning. `hook_specific_output.tool_input` rewrites the arguments. A pre_tool allow has no add-context channel (`system_message` is UI only). `post_tool` supports `hook_specific_output.additional_context`. VERIFIED-DOCS + VERIFIED-SOURCE
- 5. Claude Code hooks: runs Claude Code plugin hooks (`.claude-plugin/plugin.json` plus `hooks/hooks.json`), mapping PreToolUse to pre_tool, PostToolUse to post_tool, and Stop to post_agent. `HookProtocol` enum = `VIBE | CLAUDE_CODE | KIMI_CODE`. VERIFIED-SOURCE vibe/core/plugins/_claude.py, vibe/core/hooks/models.py. Whether it reads bare `.claude/settings.json` hooks is UNVERIFIED.
- 6. Trust: project `.vibe/` (hooks, MCP, tools) loads only in trusted folders (`~/.vibe/trusted_folders.toml`). `vibe -p` needs `--trust`. VERIFIED-DOCS README
- 7. MCP: `[[mcp_servers]]` in Vibe `config.toml`, or `vibe mcp add NAME --transport stdio --command CMD --arg ...`. VERIFIED-DOCS README
- 8. Rules/skills: AGENTS.md (read lazily per directory). Skills load from `.vibe/skills`, `.agents/skills`, and `~/.vibe/skills`. VERIFIED-DOCS README. ACP is supported (docs/acp-setup.md exists). VERIFIED-SOURCE

### Hermes Agent (NousResearch/hermes-agent, 255k stars)
- 1. Pre-edit hook: shell hook event `pre_tool_call`, plus Python plugin hook `ctx.register_hook("pre_tool_call", fn)`. VERIFIED-DOCS https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/hooks.md
- 2. Config: a `hooks:` block in profile `~/.hermes/config.yaml`. User-level only; there is no project-level hooks file.
  ```yaml
  hooks:
    pre_tool_call:
      - matcher: "write_file|patch"        # regex on tool name
        command: "landmine hook --agent hermes"
        timeout: 10
        fail_closed: false                 # failClosed also accepted (Cursor/Claude compat)
  ```
- 3. Payload: `hook_event_name: "pre_tool_call"`, `tool_name`, `tool_input`, `session_id`, `cwd`, `profile`, `extra: {task_id, tool_call_id, ...}`. Edit tools are `write_file` and `patch`, and the path is `tool_input.path`. `patch` has a `mode` (replace / V4A patch). VERIFIED-DOCS (hooks.md examples) + VERIFIED-SOURCE tools/file_tools.py
- 4. Block: stdout `{"decision":"block","reason":"..."}` (Claude-Code style) or `{"action":"block","message":"..."}`. Exit `2` also blocks, with the reason taken from stdout JSON, then the first 400 characters of stderr, then a default. Other failures fail open unless `fail_closed`. Context channel: `pre_llm_call` returns `{"context":"..."}`. There is no per-tool add-context. VERIFIED-DOCS
- 5. Claude Code hooks: accepts Claude-style output and exit-2 semantics. `hermes import-agent claude-code` imports MCP, skills, and permissions but not hooks (hooks are absent from the mapping table). VERIFIED-DOCS website/docs/user-guide/import-from-other-agents.md
- 6. Trust: a first-use consent prompt for each `(event, command)` pair, persisted to `~/.hermes/shell-hooks-allowlist.json`. Non-interactive surfaces (gateway, `hermes acp`, CI) need `--accept-hooks`, `HERMES_ACCEPT_HOOKS=1`, or `hooks_auto_accept: true`. The allowlist keys on the command string, so script edits are silently trusted. VERIFIED-DOCS
- 7. MCP: `mcp_servers:` in `config.yaml` (`command: "npx"`, ...). VERIFIED-DOCS features/mcp.md
- 8. Rules/skills: `.hermes.md`/`HERMES.md`, `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `.cursorrules`, `SOUL.md`. VERIFIED-DOCS features/context-files.md. Has a skills system (features/skills.md) and ACP (features/acp.md). VERIFIED-SOURCE (files exist)

### OpenClaw (openclaw/openclaw, 393k stars; a personal agent, not primarily a coding agent)
- 1. Pre-edit hook: plugin hook `before_tool_call`, which can block, rewrite params, or require approval. Event fields: `event.toolName`, `event.params`, optional `event.derivedPaths` ("best-effort host-derived target path hints for well-known tool envelopes such as `apply_patch`"), `event.toolCallId`, and `ctx.sessionId`. VERIFIED-DOCS https://github.com/openclaw/openclaw/blob/main/docs/plugins/hooks/tool-policy.md
- 2. Config: a TS plugin with `api.on("before_tool_call", handler, { matcher: [...], priority })` inside `register(api)`. There is no shell-hook JSON for tool calls. The "internal hooks" in docs/automation/hooks are message/command lifecycle events, not tool policy.
- 4. Block: return `{ block: true, blockReason: "..." }`, or `{ requireApproval: {...} }`, or `{ params }` to rewrite. VERIFIED-DOCS
- 5. Claude Code hooks: NO. "Claude `hooks/hooks.json` remains in the declared capabilities, but does not appear as a supported hook." Only OpenClaw `HOOK.md` + `handler.ts` hook packs run. VERIFIED-DOCS docs/plugins/bundles.md
- 7/8. Bundles map Agent Plugins, Claude, Codex, and Cursor bundles into skills, hooks, and MCP tools. VERIFIED-DOCS bundles.md. AGENTS.md handling is UNVERIFIED.

### oh-my-pi (can1357/oh-my-pi, 36k stars; "Coding agent with the IDE wired in", a fork of Pi)
- 1. Pre-edit hook: TS hook factories using `pi.on("tool_call", ...)`. VERIFIED-DOCS https://github.com/can1357/oh-my-pi/blob/main/docs/hooks.md
- 2. Config: `<cwd>/.omp/hooks/pre/*.ts|js`, `<cwd>/.omp/hooks/post/*.ts|js`, and user `~/.omp/agent/hooks/pre|post/`. A factory placed directly in `hooks/` is not discovered.
  ```ts
  export default function hook(pi) {
    pi.on("tool_call", async (event, ctx) => {
      if (event.toolName === "edit") return { block: true, reason: "landmine: ..." };
    });
  }
  ```
- 4. Block: return `{ block: true, reason }`, and the reason becomes the thrown tool error. A handler that throws fails closed. Context channel: `additionalContext`, delivered with developer/system priority before the next provider request, which is a non-blocking path. `input` rewrites the arguments. The `edit` event input may include derived `path`/`paths`. VERIFIED-DOCS
- 5. Claude Code hooks: no JSON shell hooks are documented. The docs only say the layout "mirrors `.claude/hooks/pre|post/`". UNVERIFIED for any Claude settings import.

### Devin CLI (Cognition, the Windsurf owner; closed source)
- 1. Pre-edit hook: `PreToolUse` (also PostToolUse, PermissionRequest, UserPromptSubmit, Stop, PostCompaction, SessionStart, SessionEnd). Hook types are `command` and `prompt`. VERIFIED-DOCS https://docs.devin.ai/cli/extensibility/hooks/overview
- 2. Config: project `.devin/hooks.v1.json` (the whole file is the hooks object), `.devin/config.json` / `.devin/config.local.json` `"hooks"`. User: `~/.config/devin/config.json`. Devin also reads `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude.json`, `~/.claude/settings.json`, and `~/.claude/settings.local.json` (Claude Code format) when `read_config_from.claude` is enabled, which is the default. Project files are discovered up to the repo root. VERIFIED-DOCS
  ```json
  {"PreToolUse":[{"matcher":"^(edit|write|apply_patch)$","hooks":[{"type":"command","command":"landmine hook --agent devin","timeout":10}]}]}
  ```
- 3. Payload: `hook_event_name`, `tool_name`, `tool_input`, `session_id`, `prompt_id`. The env var `DEVIN_PROJECT_DIR` is set. Tool names are lowercase: `read`, `write`, `edit`, `apply_patch`, `notebook_edit`, and `exec` for shell. VERIFIED-DOCS https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks
- 4. Block: exit `2`, or stdout `{"decision":"block","reason":"..."}`, where the "reason" is "Explanation shown to the agent". Other exit codes are logged and do not block. `hookSpecificOutput.updatedInput` merges into the arguments. `hookSpecificOutput.additionalContext` is documented for UserPromptSubmit, SessionStart, and PostToolUse only. VERIFIED-DOCS
- 5. Claude Code hooks: yes, natively (see 2). GOTCHA: the matcher is a regex on Devin's lowercase tool names. A Claude matcher of `"Edit|Write"` probably will not fire on `edit`/`write`. Whether Devin translates Claude matchers is UNVERIFIED.
- 6. Trust: none documented. UNVERIFIED
- 7. MCP: `.devin/mcp_config.json`, `.devin/mcp_config.local.json`, `~/.config/devin/mcp_config.json` with `mcpServers` (since v3000.3). Devin also imports `.cursor/mcp.json` and others. VERIFIED-DOCS https://docs.devin.ai/cli/extensibility/mcp/configuration
- 8. Rules/skills: `AGENTS.md`, `~/.config/devin/AGENTS.md`, `~/.claude/CLAUDE.md`, `.windsurf/rules`, `.cursor/rules`. Skills come from `SKILL.md`, `.claude/skills`, and `.windsurf/skills`. VERIFIED-DOCS https://docs.devin.ai/cli/extensibility/rules, https://docs.devin.ai/cli/reference/configuration/read-config-from. ACP is supported (Zed/JetBrains/Xcode). VERIFIED-DOCS (llms.txt)

### Qoder CLI / Qoder IDE (Alibaba; successor to the Tongyi Lingma agent line)
- 1/2. `PreToolUse` among 23 Claude-identical events (including PermissionDenied, FileChanged, Elicitation...). Config: `~/.qoder/settings.json`, `${project}/.qoder/settings.json`, `${project}/.qoder/settings.local.json`, merged. VERIFIED-DOCS https://docs.qoder.com/en/cli/hooks
- 3. Payload: `tool_name`, `tool_input`, `tool_use_id`, plus `session_id`, `cwd`, `hook_event_name`. Tool names are `Write`, `Edit`, `Bash`, `Read`... (MultiEdit is not mentioned). VERIFIED-DOCS
- 4. Block: exit `2`, with stderr fed back to the agent. Or `hookSpecificOutput {hookEventName, permissionDecision: deny, permissionDecisionReason, updatedInput, additionalContext}` (PreToolUse supports additionalContext). `hookEventName` is mandatory. VERIFIED-DOCS
- 5. Claude Code hooks: the schema is a 1:1 clone, but the docs do not mention reading `.claude/`. UNVERIFIED. Trust: none documented. The Qoder IDE/JetBrains plugin supports 5 events including PreToolUse (https://docs.qoder.com/extensions/hooks). VERIFIED-DOCS (search snippet only)

### CodeBuddy Code (Tencent; CLI + IDE)
- 1/2. `PreToolUse` among 27+ Claude-style events. Config: `~/.codebuddy/settings.json`, `.codebuddy/settings.json`, `.codebuddy/settings.local.json`, plus an enterprise policy file. VERIFIED-DOCS https://www.codebuddy.cn/docs/cli/hooks
- 3. Payload: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `generation_id`, `tool_name`, `tool_input`. The CLI tool names are `Edit` and `Write`. The older Tencent Cloud IDE doc names the tools `write_to_file` and `replace_in_file`. VERIFIED-DOCS (both pages)
- 4. Block: exit `2` (docs: "stdout is the preferred message source, stderr fallback", which differs from Claude). Or `hookSpecificOutput.permissionDecision: deny` + `permissionDecisionReason`, with the reason passed to the agent. `modifiedInput` rewrites the arguments. `additionalContext` is documented for PostToolUse, UserPromptSubmit, and SessionStart. VERIFIED-DOCS
- 5. Claude Code hooks: Tencent Cloud docs say "fully compatible with the Claude Code Hooks specification". Reading `.claude/settings.json` is not mentioned. VERIFIED-DOCS https://intl.cloud.tencent.com/document/product/1256/77296
- 6. Trust: hooks are snapshotted at startup, and edits must be reviewed in `/hooks` before they apply. Frontmatter hooks from non-built-in sources are skipped unless `allowUntrustedFrontmatterHooks: true`. VERIFIED-DOCS

### Tabnine CLI (Tabnine; Gemini-CLI-derived)
- `BeforeTool` (plus SessionStart, SessionEnd, BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeToolSelection, AfterTool, PreCompress, Notification). Config: `.tabnine/agent/settings.json` `hooks`. Base stdin: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`. BeforeTool adds `tool_name`, `tool_input`, `mcp_context`, `original_request_name`. Edit tool example: `write_file`. Block with `{"decision":"deny","reason":...}` (the reason reaches the agent as a tool error) or with exit 2, where stderr is the reason. `$GEMINI_PROJECT_DIR` is aliased to `$TABNINE_PROJECT_DIR`. Project hooks are fingerprinted, and untrusted folders do not load them. VERIFIED-DOCS https://docs.tabnine.com/main/getting-started/tabnine-cli/features/hooks , .../hooks/event-reference . Trust/fingerprint details come from a search snippet of the examples page (UNVERIFIED-ish).

### Snowflake Cortex Code (CoCo CLI + Desktop)
- `PreToolUse` (plus PostToolUse, PermissionRequest, SessionStart, UserPromptSubmit, Stop, Notification, PreCompact, SessionEnd, SubagentStop, Setup). Config: `~/.snowflake/cortex/settings.json`, `<ws>/.snowflake/cortex/settings.json` or `<ws>/.cortex/settings.json`, and `~/.snowflake/cortex/hooks.json` (shared with the CLI). Stdin: `session_id`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`. Block with exit 2 (stderr is the reason) or `{"decision":"block","reason":...}`. The agent sees "[Hook] Tool execution blocked: <reason>". Built-in tool names are lowercase. VERIFIED-DOCS https://docs.snowflake.com/user-guide/cortex-code/cortex-code-desktop/hooks

### Firebender (Android Studio / JetBrains agent)
- Cursor-style `.firebender/hooks.json` (project) and `~/.firebender/hooks.json`. Events: `preToolUse`, `beforeShellExecution`, `beforeReadFile`, `afterFileEdit`, and others. preToolUse stdin: `tool_name`, `tool_input`, `tool_use_id`, `cwd`, `agent_message`, plus base fields `conversation_id`, `generation_id`, `model`, `hook_event_name`, `workspace_roots`, `transcript_path`. Block with `{"decision":"deny","reason":...}`, where the reason is "shown to agent when denied", or with exit 2. VERIFIED-DOCS https://docs.firebender.com/multi-agent/hooks

### Letta Code (letta-ai/letta-code, 3.7k stars, vendor-backed by Letta; below the 5k threshold but a Claude-clone)
- `PreToolUse` and others in `~/.letta/settings.json`, `.letta/settings.json`, `.letta/settings.local.json`. Exit `2` blocks, with stderr as feedback. The payload base uses `event_type` and `working_directory` (NOT `hook_event_name`/`cwd`), plus `session_id`, `tool_name`, `tool_input`. Edit tools: `Edit`, `Write`, `ApplyPatch`. Supports `updatedInput` and `additionalContext`. VERIFIED-SOURCE https://github.com/letta-ai/letta-code/blob/main/src/hooks/types.ts , src/hooks/loader.ts , src/hooks/executor.ts

### Claude Agent SDK (anthropics/claude-agent-sdk-python 8.3k stars; also TS)
- Programmatic `options.hooks = { PreToolUse: [{ matcher: "Write|Edit", hooks: [callback] }] }`. The callback gets `(input, toolUseID, {signal})`. Return `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` ("tells the model why"). IMPORTANT: shell hooks from settings files also run "when the corresponding settingSources entry is enabled, which it is for default query() options". So landmine's `.claude/settings.json` hook applies to any Agent-SDK app with default options. VERIFIED-DOCS https://code.claude.com/docs/en/agent-sdk/hooks

### OpenAI Agents SDK (openai/openai-agents-python, 30k stars), a framework, not an agent
- `@tool_input_guardrail` returns `ToolGuardrailFunctionOutput.reject_content("msg")`, which goes to the model. It only applies to FunctionTools (including local MCP tools). Hosted tools and built-in ShellTool/ComputerTool "do not use this guardrail pipeline". VERIFIED-DOCS https://openai.github.io/openai-agents-python/guardrails/

### Cursor CLI (`agent` / cursor-agent; complements the Cursor section owned elsewhere)
- The CLI changelog (Jan 2026) lists "Hooks... Claude Code `settings.json` hooks are read and merged". Apr 2026: "Hooks fire reliably... Claude Code-format hook responses are accepted". May 2026: "Hooks accept payloads over stdin". VERIFIED-DOCS https://cursor.com/docs/cli/changelog.md
- Whether `preToolUse` fires for file edits in the CLI is UNVERIFIED. A forum staff reply (Jan 2026) said the CLI then only fired `beforeShellExecution`/`afterShellExecution`. https://forum.cursor.com/t/cursor-cli-doesnt-send-all-events-defined-in-hooks/148316
- Cursor third-party hook mapping: Claude `permissionDecisionReason` maps to Cursor `user_message` (shown to the USER), NOT `agent_message`. Claude `Edit` and `Write` both map to Cursor `Write`. Enabled by default via Settings → Agents → Third-Party Imports. VERIFIED-DOCS https://cursor.com/docs/reference/third-party-hooks

### Non-qualifying or dead (one line each)
- iFlow CLI (iflow-ai/iflow-cli, 5.1k stars): had Claude-identical hooks in `.iflow/settings.json` (tools `replace`, `multi_edit`, `write_file` with Claude aliases), but the product was shut down on April 17, 2026 (repo commit 2026-03-20 "Add shutdown notice"). VERIFIED-SOURCE https://github.com/iflow-ai/iflow-cli/blob/main/docs_en/examples/hooks.md
- Amazon Q Developer CLI (aws/amazon-q-developer-cli, 2k stars): agent-config hooks with `preToolUse`, exit 2 = block with stderr to the LLM, and tool `fs_write`. The repo is in maintenance and the product moved to closed-source Kiro CLI (covered in the Kiro section). VERIFIED-SOURCE https://github.com/aws/amazon-q-developer-cli/blob/main/docs/hooks.md
- Plandex (15.8k stars): no user hooks (`app/server/hooks` is internal), and Plandex Cloud is "winding down as of 10/3/2025". VERIFIED-SOURCE
- Void (voideditor/void, 28.7k stars): archived. VERIFIED-SOURCE
- Sourcegraph Cody: the public snapshot is archived, and Cody was superseded by Amp. VERIFIED-SOURCE (sourcegraph/cody-public-snapshot archived)
- ForgeCode (tailcallhq/forgecode, 7.6k stars): only internal Rust hooks (compaction, doom_loop, title...), with no user-configurable pre-tool hook found in the tree. VERIFIED-SOURCE (negative)
- mini-swe-agent (8.7k stars): a minimal research agent with no hook system. UNVERIFIED (not inspected)
- Rovo Dev CLI (Atlassian): "Event Hooks" (e.g. `on_tool_permission`) run notification commands. Nothing documents blocking or I/O, and the team is "exploring event hook input and output support". VERIFIED-DOCS (Atlassian blog) https://www.atlassian.com/blog/developer/streamline-rovo-dev-cli-with-event-hooks
- Google Jules: no hook mechanism found. UNVERIFIED
- Codex IDE extension: Codex hook docs only mention the CLI (`/hooks`), so coverage of the IDE surface is UNVERIFIED. https://learn.chatgpt.com/docs/hooks
- Below 5k stars but with hooks: coder/xum (formerly mux, 2.1k): `.xum/tool_pre` executable, non-zero exit blocks, env `XUM_TOOL`/`XUM_TOOL_INPUT_*`. superagent-ai/grok-cli (3.5k, community, not xAI): Claude-style PreToolUse types. Nano-Collective/nanocoder (2.5k): `pre-tool-use` in `agents.config.json`; the project hooks block replaces global hooks entirely. VERIFIED-SOURCE (respective docs/ and src/hooks/types.ts)

---

## Part 2: Cross-agent standards

- **No shared hooks standard exists.** VERIFIED-DOCS/SOURCE:
  - Agent Plugins spec (agentplugins/agent-plugins-spec; TSC from Amazon, Cursor, Microsoft, OpenAI, Vercel; v1.0.0/1.1.0) covers only Agent Skills and MCP. It says: "Other proposed component types — such as commands, hooks, agents, rules, and LSP servers — remain too client-specific for a stable portable contract and are outside the v1 format until their formats converge." Hooks may only live under a reverse-domain client namespace dir, e.g. `com.example.client/hooks/hooks.json`. https://github.com/agentplugins/agent-plugins-spec/blob/main/FUTURE_CONSIDERATIONS.md , spec/1.1.0.md
  - The Agent Skills spec (agentskills.io) frontmatter is `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`. There is no hooks field. https://agentskills.io/specification
  - AGENTS.md: open proposal issue #149 ("enable interoperable linking with skills, hooks, and rules"), with nothing adopted. https://github.com/agentsmd/agents.md/issues/149
- **De-facto convergence is on the Claude Code schema**: `PreToolUse`, stdin `{hook_event_name, session_id, cwd, tool_name, tool_input}`, exit 2 = block with stderr to the model, and `hookSpecificOutput.permissionDecision/permissionDecisionReason`. Clones or near-clones: Qoder, CodeBuddy, Letta Code (field names differ), Snowflake CoCo, iFlow (dead), Devin CLI, and Kimi Code (output side only). Cursor-schema clones: Firebender. Gemini-schema clones: Tabnine CLI.
- **Agents that read Claude Code-format hook FILES natively (with evidence):**
  - Cursor IDE: `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json`, on by default. Reason maps to `user_message`. VERIFIED-DOCS https://cursor.com/docs/reference/third-party-hooks
  - Cursor CLI: "Claude Code settings.json hooks are read and merged" (Jan 2026). VERIFIED-DOCS https://cursor.com/docs/cli/changelog.md
  - Devin CLI: `.claude/settings*.json`, `~/.claude.json`, `~/.claude/settings*.json`, default on. VERIFIED-DOCS
  - VS Code (Copilot Local harness): `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`, but only with `chat.useClaudeHooks` (off by default). "Local parses nested commands but ignores matcher values, so every command for the event runs." VERIFIED-DOCS https://code.visualstudio.com/docs/copilot/customization/hooks
  - Mistral Vibe: Claude Code plugin `hooks/hooks.json` only. VERIFIED-SOURCE
  - Claude Agent SDK apps: settings hooks load by default. VERIFIED-DOCS
  - Explicit NO: OpenClaw (Claude `hooks/hooks.json` "does not appear as a supported hook"). VERIFIED-DOCS
  - Hermes: no file import, but it accepts Claude-style output and exit 2. VERIFIED-DOCS
- **Agent Client Protocol (ACP)**, https://agentclientprotocol.com , repo agentclientprotocol/agent-client-protocol (4.5k stars):
  - `session/request_permission` is agent-initiated and optional: "The Agent **MAY** request permission from the user before executing a tool call". Options have kinds `allow_once | allow_always | reject_once | reject_always`. The client responds `{outcome:{outcome:"selected", optionId}}` or `cancelled`. **There is no reason/message field in the response**, so an ACP client can veto an edit (if the agent asks) but cannot tell the model why through standard fields (`_meta` extensibility only). Tool calls carry `kind: "edit"`, `locations`, `rawInput`, and `diff` content, so a client can see the path and diff before approving. VERIFIED-SOURCE docs/protocol/v1/tool-calls.mdx
  - `fs/write_text_file` (client-side writes) exists in v1, but the Active v2 RFD "will remove the standard Client filesystem and terminal execution surface" because "it has not been widely adopted". So clients cannot rely on seeing writes through ACP fs. VERIFIED-SOURCE docs/rfds/v2/client-filesystem-terminal-capabilities.mdx
  - The Draft RFD "Agent Extensions via ACP Proxies" proposes proxies between client and agent as "a universal extension mechanism that can subsume AGENTS.md, hooks, MCP servers". That is a possible future landmine form factor (an ACP proxy that rejects edit permission requests). Still Draft. VERIFIED-SOURCE docs/rfds/proxy-chains.mdx, docs/docs.json
  - ACP agents seen: Kimi Code, Mistral Vibe, Hermes, Devin CLI, Cursor CLI (`cursor.com/docs/cli/acp.md`). VERIFIED-SOURCE/DOCS (doc pages exist)
- **MCP elicitation**: a server-initiated request for user input. It cannot intercept an agent's built-in edit tools, so it is not a pre-edit hook. (Reasoning; spec not re-fetched.)

---

## Part 3: LSP / editor-diagnostics feedback channel (post-edit, NOT pre-edit)

All of these fire AFTER the write lands, so this channel can only warn after the fact; it cannot block. A diagnostic must be NEW relative to the pre-edit snapshot and is usually ERROR-only.

| Agent | Mechanism | What is fed back | Default | Evidence |
|---|---|---|---|---|
| Cline v3.x (VS Code, legacy) | `DiffViewProvider.saveChanges` diffs pre/post `getDiagnostics` across the workspace | "New problems detected after saving the file:" + **Error severity only** | on | VERIFIED-SOURCE https://github.com/cline/cline/blob/v3.30.0/src/integrations/editor/DiffViewProvider.ts (lines ~120-135, 270-272) |
| Cline v4.1.x (current main, SDK-based) | `getNewDiagnostics` / `newProblemsMessage` still defined, but no callers found; the SDK `editor`/`apply_patch` executors have no diagnostics refs | appears removed | n/a | VERIFIED-SOURCE (negative code search) apps/vscode/src/integrations/diagnostics/index.ts, apps/vscode/src/core/prompts/responses.ts, sdk/packages/core/src/extensions/tools/executors/editor.ts |
| Roo Code (repo ARCHIVED on GitHub) | same pattern, waits `writeDelayMs` (default 1000) | Error only, `maxDiagnosticMessages` default 50, `includeDiagnosticMessages` default true | `diagnosticsEnabled` default true | VERIFIED-SOURCE https://github.com/RooCodeInc/Roo-Code/blob/main/src/integrations/editor/DiffViewProvider.ts |
| GitHub Copilot (VS Code agent; source moved to microsoft/vscode `extensions/copilot`) | `EditFileResult` waits `diagnosticsTimeout ?? 1000` ms, then takes new diagnostics for the edited file | "The edit resulted in the following lint errors:" + **Error AND Warning**, max 20 | gated by `github.copilot.chat.agent.autoFix` (default false, tag `onExp`, i.e. experiment-controlled). The model can also call the `get_errors` tool on demand | VERIFIED-SOURCE https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/tools/node/editFileToolResult.tsx , extensions/copilot/package.json |
| Kilo Code (VS Code ext + CLI are now OpenCode-based: packages/opencode) | the agent spawns its own LSP servers; `edit` calls `lsp.touchFile` then `lsp.diagnostics()` | "LSP errors detected in this file, please fix:" + `<diagnostics file=...>`, severity 1 (ERROR) only, max 20 per file | on (per LSP config) | VERIFIED-SOURCE https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/tool/edit.ts , packages/opencode/src/lsp/diagnostic.ts |
| OpenCode (same code) | custom LSP servers configurable: `"lsp": {"landmine": {"command": ["landmine","lsp","--stdio"], "extensions": [".ts",".py"]}}` | as above | n/a | VERIFIED-DOCS https://opencode.ai/docs/lsp/ |

Implication for landmine: a VS Code extension that publishes `vscode.languages.createDiagnosticCollection` Error diagnostics on the edited file right after save would surface as model-visible "new problems" in Roo (archived), legacy Cline v3, and Copilot (only when autoFix is on, or via get_errors). For OpenCode/Kilo, a stdio LSP server registered under `lsp` in opencode.json/kilo config is a model-visible post-edit channel that needs no VS Code. It does not work for current Cline v4.

---

#### Table rows
| agent | pre-edit hook? | block mechanism | context channel | config path | MCP | rules/skills |
|---|---|---|---|---|---|---|
| Kimi Code CLI | Yes `PreToolUse` (tools `Edit`/`Write`, arg `path`) | exit 2 (stderr) or `hookSpecificOutput.permissionDecision:"deny"` | stdout on exit 0 "may be appended" (UNVERIFIED for PreToolUse) | `~/.kimi-code/config.toml` `[[hooks]]` (user only) + plugins | `~/.kimi-code/mcp.json`, `.kimi-code/mcp.json` | AGENTS.md, SKILL.md (`.kimi-code/skills`, `.agents/skills`), ACP |
| Mistral Vibe | Yes `pre_tool` (`file_system.write_file` / `file_system.search_replace`; match `write_file`/`edit`) | exit 0 + `{"decision":"deny","reason"}`; non-zero = fail-open unless `strict` | none on pre_tool (`post_tool` has `additional_context`) | `.vibe/hooks.toml` (trusted), `~/.vibe/hooks.toml`; runs Claude plugin `hooks/hooks.json` | `[[mcp_servers]]` in config.toml | AGENTS.md, `.vibe/skills`, `.agents/skills`, ACP |
| Hermes Agent | Yes `pre_tool_call` (`write_file`, `patch`) | exit 2 or `{"decision":"block","reason"}` / `{"action":"block","message"}` | `pre_llm_call` → `{"context"}` | `~/.hermes/config.yaml` `hooks:` (user only); consent allowlist | `mcp_servers:` in config.yaml | AGENTS.md, CLAUDE.md, .hermes.md, .cursorrules, skills, ACP |
| OpenClaw | Yes plugin `before_tool_call` (TS) | return `{block:true, blockReason}` / `requireApproval` | (not per-tool; UNVERIFIED) | TS plugin `register(api)`; no Claude hooks | via bundles | skills via bundles; AGENTS.md UNVERIFIED |
| oh-my-pi | Yes `pi.on("tool_call")` (TS) | return `{block:true, reason}`; throw = fail-closed | `additionalContext` (developer priority) | `.omp/hooks/pre/*.ts`, `~/.omp/agent/hooks/pre/` | UNVERIFIED | UNVERIFIED |
| Devin CLI | Yes `PreToolUse` (`edit`, `write`, `apply_patch`) | exit 2 or `{"decision":"block","reason"}` | `additionalContext` (not on PreToolUse) | `.devin/hooks.v1.json`, `~/.config/devin/config.json`, AND `.claude/settings*.json` (default on) | `.devin/mcp_config.json`, `~/.config/devin/mcp_config.json` | AGENTS.md, CLAUDE.md, .cursor/.windsurf rules, SKILL.md, ACP |
| Qoder CLI | Yes `PreToolUse` (`Edit`, `Write`) | exit 2 (stderr) or `permissionDecision:"deny"` | `additionalContext` on PreToolUse | `~/.qoder/settings.json`, `.qoder/settings(.local).json` | UNVERIFIED | UNVERIFIED |
| CodeBuddy Code | Yes `PreToolUse` (`Edit`, `Write`) | exit 2 (stdout preferred, stderr fallback) or `permissionDecision:"deny"` | `additionalContext` (Post/Prompt/SessionStart) | `~/.codebuddy/settings.json`, `.codebuddy/settings(.local).json`; `/hooks` review required | UNVERIFIED | UNVERIFIED |
| Tabnine CLI | Yes `BeforeTool` (`write_file`) | exit 2 (stderr) or `{"decision":"deny","reason"}` | none on BeforeTool (AfterTool has additionalContext) | `.tabnine/agent/settings.json` | UNVERIFIED | UNVERIFIED |
| Snowflake Cortex Code | Yes `PreToolUse` (lowercase tools) | exit 2 (stderr) or `{"decision":"block","reason"}` | UNVERIFIED | `~/.snowflake/cortex/settings.json` / `hooks.json`, `.cortex/settings.json` | UNVERIFIED | UNVERIFIED |
| Firebender | Yes `preToolUse` (Cursor-style) | exit 2 or `{"decision":"deny","reason"}` | UNVERIFIED | `.firebender/hooks.json`, `~/.firebender/hooks.json` | UNVERIFIED | UNVERIFIED |
| Letta Code (3.7k) | Yes `PreToolUse` (`Edit`, `Write`, `ApplyPatch`) | exit 2 (stderr) | `additionalContext` | `.letta/settings(.local).json`, `~/.letta/settings.json` | UNVERIFIED | UNVERIFIED |
| Claude Agent SDK apps | Yes callback `PreToolUse` + settings-file hooks by default | `permissionDecision:"deny"` + reason | `additionalContext` | `options.hooks`; `.claude/settings.json` via settingSources | `mcpServers` option | CLAUDE.md, skills (via settingSources) |
| Cursor CLI | Partial: reads `.cursor/hooks.json` + Claude settings hooks; edit `preToolUse` firing UNVERIFIED | exit 2 / `permission:"deny"` | `agent_message` (Claude reason maps to `user_message`) | `.cursor/hooks.json`, `~/.cursor/hooks.json`, `.claude/settings.json` | `.cursor/mcp.json` (UNVERIFIED for CLI) | AGENTS.md / .cursor/rules (UNVERIFIED for CLI), ACP |
| iFlow CLI | DEAD (shut down 2026-04-17) | exit 2 | n/a | `.iflow/settings.json` | n/a | n/a |
| Rovo Dev CLI | No (notification-only event hooks) | none | none | `~/.rovodev/config.yml` | yes (config.yml) | UNVERIFIED |
| Amazon Q Dev CLI | Yes `preToolUse` (`fs_write`), but superseded by Kiro CLI | exit 2 (stderr to LLM) | n/a | agent config JSON | yes | n/a |
