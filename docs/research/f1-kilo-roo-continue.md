### Kilo Code (VS Code extension + Kilo CLI `kilo`)

Context: the current Kilo is a fork of OpenCode. `Kilo-Org/kilocode` (27.7k stars) is now an OpenCode monorepo: `.opencode-version` = `v1.18.26`, and the CLI lives in `packages/opencode`, published as `@kilocode/cli`. Latest release is v7.8.15 (2026-10-19), and npm `@kilocode/cli` / `@kilocode/plugin` are both 7.8.15. The VS Code extension (`packages/kilo-vscode`, v7.8.15) is a thin client: it "spawns or connects to a `kilo serve` process and communicates via HTTP REST + SSE". So plugins, tools, MCP, and LSP all run in the CLI backend, for both the CLI and VS Code. The old Roo-fork extension repo, `Kilo-Org/kilocode-legacy`, is archived. Its AGENTS.md names upstream as `github.com/anomalyco/opencode`, not sst/opencode. [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-vscode/AGENTS.md , https://github.com/Kilo-Org/kilocode/blob/main/.opencode-version

1. **Pre-edit hook:** Yes. It is the OpenCode-style **in-process TS/JS plugin hook `"tool.execute.before"`**. Kilo has no shell/JSON hook system and no `hooks` key in the config schema. Docs state "Plugins … work in both the Kilo CLI and the VS Code extension". [VERIFIED-DOCS] https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/automate/extending/plugins.md . The hook is triggered in `packages/opencode/src/session/tools.ts` (~L197) immediately before `item.execute(args, ctx)`. It also fires for MCP tools (~L492). [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/session/tools.ts . The hook signature is:
   `"tool.execute.before"?: (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => Promise<void>`
   [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/plugin/src/index.ts (L268-271)
2. **Config locations:**
   - Plugin files in `.kilo/plugin/*.ts|js` (project; legacy `.kilocode/plugin/`) or `~/.config/kilo/plugin/` (global) are auto-registered.
   - Plugins can also be listed in the `"plugin": [...]` array of `kilo.json`/`kilo.jsonc` (project root or `.kilo/`) or `~/.config/kilo/kilo.json`. `opencode.json[c]` is also accepted.
   - Load order: built-ins, then global config, then global dir, then project config, then project dir.
   - [VERIFIED-DOCS] plugins.md above.
   
   Minimal example that calls an external command:
   ```ts
   // .kilo/plugin/landmine.ts
   import type { Plugin } from "@kilocode/plugin"
   const server: Plugin = async ({ $, directory }) => ({
     "tool.execute.before": async (input, output) => {
       if (!["edit", "write", "apply_patch"].includes(input.tool)) return
       const r = await $`landmine check --json`.stdin(JSON.stringify({ tool: input.tool, args: output.args, cwd: directory })).nothrow().quiet()
       if (r.exitCode === 2) throw new Error(r.stderr.toString())
     },
   })
   export default { id: "landmine", server }
   ```
   The `export default { id, server }` shape is required; named exports are "legacy". [VERIFIED-DOCS]
3. **Payload:**
   - `input = {tool, sessionID, callID}` and `output.args` = the raw tool args. There is **no cwd in the hook input**. Use `directory`/`worktree` from the plugin init context (`{project, client, $, directory, worktree, serverUrl}`). [VERIFIED-DOCS/SOURCE]
   - `edit` takes `{filePath, oldString, newString, replaceAll?}`. [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/tool/edit.ts
   - `write` takes `{filePath, content}`. [VERIFIED-SOURCE] .../tool/write.ts
   - `apply_patch` takes `{patchText}` (Codex-style patch). [VERIFIED-SOURCE] .../tool/apply_patch.ts
   - There is no multiedit tool.
   - `KiloToolRegistry.usePatch()` swaps `edit` for `apply_patch` when the model id contains `gpt-` (excluding gpt-4 and oss). `write` stays available in both cases. [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/kilocode/tool/registry.ts (L74-83)
4. **Block and reason:**
   - **Block:** `throw new Error(reason)` inside the hook. The tool-call part becomes `status:"error"` with `error: errorMessage(error)` (processor.ts `failToolCall`, ~L299). It is replayed to the model as `state:"output-error", errorText: part.state.error` (message-v2.ts ~L480). So the thrown message reaches the model as the tool error. [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/session/processor.ts , .../session/message-v2.ts
   - **Rewrite instead of block:** mutate `output.args`.
   - **Non-blocking context:**
     - `tool.execute.after` can rewrite `output.output`, `title`, and `metadata`, so you can append a warning to the tool result.
     - `experimental.chat.system.transform` and `chat.message` can inject into the prompt.
     - `permission.ask` can set `status:"deny"`.
     - [VERIFIED-SOURCE] index.ts
5. **Claude Code hook compat:** **No.** Claude compatibility covers only CLAUDE.md and skills, through the VS Code setting `kilo-code.new.claudeCodeCompat` (default `false`). The one-time import `kilo-code.new.experimental.claudeMigration` covers only categories `"instructions" | "skill" | "mcp"`. No hooks in either. [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-vscode/package.json , https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/kilocode/config/claude-migration.ts
6. **Trust:**
   - Docs say project-dir plugins are "auto-registered at startup", with no approval step. [VERIFIED-DOCS]
   - I found no workspace-trust gate for plugins in the source tree; only skills have a trust model (`kilocode/skill/trust.ts`). [UNVERIFIED that it is absent]
   - `KILO_PURE=1` disables all external plugins. [VERIFIED-DOCS]
   - npm plugins install with lifecycle scripts blocked. [VERIFIED-DOCS]
7. **MCP:**
   - Top-level `"mcp"` key in `kilo.json[c]` (project `./` or `./.kilo/`; global `~/.config/kilo/`).
   - Shape: `{"mcp":{"landmine":{"type":"local","command":["landmine","mcp"],"environment":{},"enabled":true}}}`. `command` is an **array**.
   - [VERIFIED-DOCS] https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/automate/mcp/using-in-kilo-code.md ; [VERIFIED-SOURCE] schema https://github.com/Kilo-Org/kilocode/blob/main/packages/core/src/config/mcp.ts
8. **Rules and skills:**
   - `AGENTS.md`/`AGENT.md` at the root. Per-directory AGENTS.md files are injected dynamically as `<system-reminder>` when the agent reads files in that directory.
   - `"instructions": [globs]` in kilo.jsonc. Legacy `.kilocode/rules/` is auto-included.
   - Skills (Agent Skills spec) load from `.kilo/skills/`, `~/.kilo/skills/`, `.agents/skills/` and `~/.agents/skills/` (on by default), and `.claude/skills/` and `~/.claude/skills/` (only with Claude compat on).
   - [VERIFIED-DOCS] https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/customize/skills.md , .../customize/agents-md.md , .../customize/custom-rules.md
   - AGENTS.md is a **write-protected file** in Kilo. [VERIFIED-DOCS]
- **Diagnostics channel:**
  - After `write`/`edit`/`apply_patch`, the CLI touches the file with **its own LSP clients**, not VS Code's Problems panel. It appends `"LSP errors detected in this file, please fix:\n<diagnostics file=…>"` to the tool output, plus up to 5 other files. Only severity 1 (ERROR) is included, max 20 per file.
  - LSP servers are configurable through the `lsp` config key (`{command:[...], extensions:[...], env, initialization, disabled}`). A custom "landmine LSP" registered there would therefore have its ERROR diagnostics fed to the model after each edit. This is a post-edit channel only.
  - [VERIFIED-SOURCE] https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/tool/write.ts (L86-100), .../src/lsp/diagnostic.ts , https://github.com/Kilo-Org/kilocode/blob/main/packages/core/src/config/lsp.ts
  - Plugin `event` hook also receives `lsp.client.diagnostics` and `file.edited` events. [VERIFIED-DOCS]

### Roo Code (RooCodeInc/Roo-Code)

Context: **The project is dead.** The GitHub repo is `archived: true` (last push 2026-05-15). The final release is v3.54.0 (2026-05-15). `roocode.com` now 301-redirects to `roomote.dev`. [VERIFIED-SOURCE: `gh api repos/RooCodeInc/Roo-Code`, releases; HTTP redirect observed] Secondary sources (not official) say the shutdown was announced around 2026-04-20/21 and the team moved to Roomote. They say official guidance points users to Cline, and that Kilo and a "Zoo Code" fork are alternatives. [UNVERIFIED] https://kilo.ai/compare/roo-code-shutdown-roomote

1. **Pre-edit hook:** **None.**
   - The repo tree has no hook subsystem. The only "hooks" are React UI hooks. [VERIFIED-SOURCE, by tree scan of main]
   - The extension API events (`packages/types/src/events.ts`: `taskStarted`, `message`, `taskToolFailed`, …) are observational only and have no veto. [VERIFIED-SOURCE] https://github.com/RooCodeInc/Roo-Code/blob/main/packages/types/src/events.ts
   - The closest pre-edit block is static: **`.rooignore`** (gitignore syntax, hot-reloaded). `write_to_file` and `apply_diff` refuse ignored paths, and the model receives `"Access to [file_path] is blocked by the .rooignore file settings. You must try to continue in the task without using this file, or ask the user to update the .rooignore file."` The catch is that it blocks reads too. [VERIFIED-DOCS] https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/rooignore.md
   - `RooProtectedController` hard-codes write-protected patterns that force approval: `.rooignore`, `.roomodes`, `.roorules*`, `.clinerules*`, `.roo/**`, `.vscode/**`, `*.code-workspace`, `AGENTS.md`, `AGENT.md`. [VERIFIED-SOURCE] https://github.com/RooCodeInc/Roo-Code/blob/main/src/core/protect/RooProtectedController.ts
2. **Config:** None for hooks.
   - Experimental "custom tools" exist in `.roo/tools/*.ts` and `~/.roo/tools/` (`defineCustomTool`, auto-approved). They add new tools but cannot intercept existing ones. [VERIFIED-DOCS] https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/experimental/custom-tools.md
3. **Payload:** No hook. For reference, the edit tool names and params are:
   - `write_to_file{path, content}`
   - `apply_diff{path, diff}`
   - `edit{file_path, old_string, new_string, replace_all}`
   - `apply_patch{patch}`
   - also `search_replace`, `edit_file`, `search_and_replace`
   - [VERIFIED-SOURCE] https://github.com/RooCodeInc/Roo-Code/blob/main/packages/types/src/tool.ts , https://github.com/RooCodeInc/Roo-Code/tree/main/src/core/prompts/tools/native-tools
4. **Block and reason:** Only through the `.rooignore` error string above. There is no dynamic channel.
5. **Claude Code hook compat:** No. [VERIFIED-SOURCE, by absence]
6. **Trust:** Not applicable.
7. **MCP:**
   - Global `mcp_settings.json` (opened through the UI), project `.roo/mcp.json`.
   - Shape: `{"mcpServers":{"name":{"command":"…","args":[…],"env":{},"alwaysAllow":[…],"disabled":false}}}`.
   - [VERIFIED-DOCS] https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/mcp/using-mcp-in-roo.mdx
8. **Rules and skills:**
   - Rules: `.roo/rules/`, `.roo/rules-{modeSlug}/`, `.roorules`, `.roorules-{mode}`, `~/.roo/rules/`.
   - `AGENTS.md`/`AGENT.md` (+ `AGENTS.local.md`) are loaded when `roo-cline.useAgentRules` is true (the default).
   - Skills: `.roo/skills/`, `~/.roo/skills/`, `.agents/skills/`, `~/.agents/skills/`.
   - [VERIFIED-DOCS] https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/custom-instructions.md , .../features/skills.mdx ; [VERIFIED-SOURCE] src/core/prompts/sections/custom-instructions.ts
- **Diagnostics channel: yes, from VS Code's Problems panel.**
  - `DiffViewProvider` snapshots `vscode.languages.getDiagnostics()` before the edit and waits `writeDelayMs` (default 1000).
  - It then appends only **new Error-severity** diagnostics to the tool result.
  - Settings: `includeDiagnosticMessages` (default true), `maxDiagnosticMessages` (default 50), `diagnosticsEnabled`.
  - So any VS Code extension or LSP publishing an Error diagnostic on the edited file reaches the model. This is post-edit only.
  - [VERIFIED-SOURCE] https://github.com/RooCodeInc/Roo-Code/blob/main/src/integrations/editor/DiffViewProvider.ts , https://github.com/RooCodeInc/Roo-Code/blob/main/packages/types/src/global-settings.ts ; [VERIFIED-DOCS] apps/docs/docs/features/diagnostics-integration.md

### Continue (continuedev/continue: VS Code/JetBrains extension + `cn` CLI)

Context: **The project is frozen.**
- The README states: "_The `continuedev/continue` repository is no longer actively maintained and is read-only for all users._" It also describes a "Final 2.0.0 Release".
- The last VS Code releases are v2.1.0-vscode and v2.0.0-vscode (2026-06-19). Main HEAD is `5522c6f` (2026-07-21), with commit message "login flow retired after acquisition".
- npm `@continuedev/cli` latest is **1.5.47** (2026-06-18).
- [VERIFIED-SOURCE] https://github.com/continuedev/continue/blob/main/README.md
- The acquirer was reportedly Cursor (The New Stack headline "Cursor quietly acquires Continue"). [UNVERIFIED, not official] https://thenewstack.io/cursor-acquires-continue-coding/

1. **Pre-edit hook: effectively NO, although the code exists.**
   - `extensions/cli/src/hooks/` (PR #11029, merged 2026-03-04) implements a **"Claude Code-compatible hooks system … so that any hook written for `claude` works with `cn` out of the box"**. It has 17 events, including `PreToolUse`, `PostToolUse`, `PermissionRequest`, `UserPromptSubmit`, `SessionStart`, and `Stop`. [VERIFIED-SOURCE] https://github.com/continuedev/continue/blob/main/extensions/cli/src/hooks/types.ts
   - However, **`firePreToolUse` (and every other `fire*`) has zero call sites** outside `hooks/fireHook.ts`, both on main and in the shipped npm 1.5.47 bundle. `executeToolCall` in `extensions/cli/src/tools/index.tsx` calls only `services.gitAiIntegration.trackToolUse(toolCall,"PreToolUse")`. HookService initializes but never fires. [VERIFIED-SOURCE: grep of sparse clone and of `@continuedev/cli@1.5.47` `dist/index.js`]
   - The PR touched only `hooks/*`, `services/*`, and AGENTS.md, so no integration points were ever added. [VERIFIED-SOURCE] https://github.com/continuedev/continue/pull/11029
   - The VS Code/JetBrains extension has no hooks at all. [VERIFIED-SOURCE, by tree scan]
2. **Config (dormant):** These settings files are loaded and merged (all run, with project overriding user):
   - `~/.claude/settings.json`
   - `~/.continue/settings.json` (or `$CONTINUE_GLOBAL_DIR`)
   - `.claude/settings.json`
   - `.continue/settings.json`
   - `.claude/settings.local.json`
   - `.continue/settings.local.json`
   
   The shape is identical to Claude Code: `{"hooks":{"PreToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"landmine hook"}]}]}}`. `type:"http"` is also supported. `prompt`/`agent` handlers are not implemented. `disableAllHooks` is honored. [VERIFIED-SOURCE] https://github.com/continuedev/continue/blob/main/extensions/cli/src/hooks/hookConfig.ts , .../hookRunner.ts
3. **Payload (if it ever fired):**
   - Fields: `{session_id, transcript_path:"", cwd, permission_mode, hook_event_name:"PreToolUse", tool_name, tool_input, tool_use_id}`.
   - Env: `CLAUDE_PROJECT_DIR` and `CONTINUE_PROJECT_DIR`.
   - `cn` tool names match Claude's (`Edit`, `MultiEdit`, `Write`), but **`Write` uses `filepath`, not `file_path`**.
   - Tool params: `Edit{file_path, old_string, new_string, replace_all}`, `MultiEdit{file_path, edits[{old_string,new_string,…}]}`, `Write{filepath, content}`.
   - IDE extension tool names: `edit_existing_file`, `single_find_and_replace`, `multi_edit`, `create_new_file`.
   - [VERIFIED-SOURCE] .../hooks/fireHook.ts , https://github.com/continuedev/continue/blob/main/extensions/cli/src/tools/builtInToolNames.ts , .../tools/writeFile.ts , https://github.com/continuedev/continue/blob/main/core/tools/builtIn.ts
   - The only live pre-edit callout is the optional **git-ai integration**. It spawns `git-ai checkpoint` with stdin `{session_id, transcript_path, cwd, hook_event_name:"PreToolUse", tool_input:{file_path}}` for Edit/MultiEdit/Write. Errors are swallowed ("Don't throw"), so it **cannot block**. [VERIFIED-SOURCE] https://github.com/continuedev/continue/blob/main/extensions/cli/src/services/GitAiIntegrationService.ts
4. **Block and reason (designed, never exercised):**
   - Exit code 2 blocks, with stderr as the reason.
   - JSON `{"decision":"block","reason":…}` or `hookSpecificOutput.permissionDecision:"deny"` + `permissionDecisionReason` also block.
   - `additionalContext` is aggregated.
   - [VERIFIED-SOURCE] hookRunner.ts
   - What works today is static only: `cn --exclude "Write(**/x)"` or `~/.continue/permissions.yaml` (`allow`/`ask`/`exclude`). `exclude` hides the tool, and headless mode excludes `ask` tools. [VERIFIED-DOCS] https://github.com/continuedev/continue/blob/main/docs/cli/tool-permissions.mdx
5. **Claude Code hook compat:** Yes by design, since it reads `.claude/settings*.json` natively. But it is non-functional because events never fire, and the Write field-name mismatch noted above remains. [VERIFIED-SOURCE]
6. **Trust:** No trust prompt in the hook loader. [VERIFIED-SOURCE]
7. **MCP:**
   - `mcpServers:` list in `~/.continue/config.yaml` (`cn` default; override with `--config`).
   - Standalone block files `.continue/mcpServers/*.yaml` (`name`/`version`/`schema: v1` + `mcpServers: [{name, command, args, env, type: stdio}]`).
   - JSON MCP configs from Claude Desktop, Cursor, or Cline can be dropped into `.continue/mcpServers/` as-is.
   - [VERIFIED-DOCS] https://github.com/continuedev/continue/blob/main/docs/customize/deep-dives/mcp.mdx , https://github.com/continuedev/continue/blob/main/docs/cli/configuration.mdx
8. **Rules and skills:**
   - Rules: `.continue/rules/*.md` (frontmatter `globs`, `alwaysApply`, `description`).
   - Agent files loaded: `AGENTS.md`, `AGENT.md`, `CLAUDE.md` (core). `cn` adds `CODEX.md`.
   - Skills: the IDE loads only `.claude/skills/`. `cn` loads `.continue/skills/`, `.claude/skills/`, and `~/.continue/skills/`.
   - [VERIFIED-SOURCE] https://github.com/continuedev/continue/blob/main/core/config/markdown/loadMarkdownRules.ts , .../core/config/markdown/loadMarkdownSkills.ts , https://github.com/continuedev/continue/blob/main/extensions/cli/src/util/loadMarkdownSkills.ts , .../extensions/cli/src/systemMessage.ts
- **Diagnostics channel:** No post-edit diagnostics injection in `core/tools`. [VERIFIED-SOURCE, by grep] I did not inspect the VS Code extension's apply path. [UNVERIFIED] Users can pull diagnostics manually through the `@problems` context mention.

#### Table rows
| agent | pre-edit hook? | block mechanism | context channel | config path | MCP | rules/skills |
|---|---|---|---|---|---|---|
| Kilo Code (CLI + VS Code, OpenCode fork v7.8.15) | Yes: TS plugin `tool.execute.before` (tools `edit`/`write`/`apply_patch`) | `throw new Error(reason)`: becomes tool `errorText` sent to model; or mutate `output.args` | `tool.execute.after` rewrite `output.output`; `experimental.chat.system.transform`; post-edit LSP ERRORs auto-appended (custom server via `lsp` key) | `.kilo/plugin/*.ts`, `~/.config/kilo/plugin/`, `"plugin":[]` in `kilo.json[c]` | `"mcp":{name:{type:"local",command:[...]}}` in `kilo.json[c]` / `~/.config/kilo/kilo.json` | AGENTS.md (+ per-dir), `instructions` globs, `.kilo/skills`, `.agents/skills`, `.claude/skills` (compat flag) |
| Roo Code (archived 2026-05-15) | No | Static only: `.rooignore` (blocks read + write, fixed error string) | Post-edit new VS Code Error diagnostics (`includeDiagnosticMessages`, `maxDiagnosticMessages`, `writeDelayMs`) | n/a | `.roo/mcp.json`, global `mcp_settings.json` (`mcpServers`) | `.roo/rules[-mode]/`, `.roorules`, AGENTS.md (`roo-cline.useAgentRules`), `.roo/skills`, `.agents/skills` |
| Continue (`cn` CLI 1.5.47 + IDE; repo read-only) | Code present but dormant: Claude-compatible `PreToolUse` never fired; IDE: none | (designed) exit 2 / `permissionDecision:"deny"`; today only static `--exclude "Write(glob)"` / `~/.continue/permissions.yaml` | none live (`additionalContext` designed, unused) | (dormant) `.continue/settings[.local].json`, `~/.continue/settings.json`, **also reads `.claude/settings*.json`** | `config.yaml` `mcpServers:` / `.continue/mcpServers/*.yaml` or Claude/Cursor JSON dropped in | `.continue/rules/*.md`, AGENTS.md/AGENT.md/CLAUDE.md (+CODEX.md in cn), `.claude/skills`, `.continue/skills` |
