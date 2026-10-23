# landmine for Claude Code

Coding agents write code against the API they remember, not the version your lockfile pins. When that exact version has an open, already-filed upstream bug, the agent walks into it. This plugin puts those bugs in front of Claude Code before it edits.

- **`/landmines:scan`** finds the open GitHub issues filed against your exact dependency versions (npm, pnpm, yarn, bun, uv, poetry, Pipfile, pinned requirements) and writes a short known-bugs section into CLAUDE.md, ranked by the APIs your code calls.
- **Pre-edit hook.** When an edit uses an API from a matching issue, it pauses the edit once and shows the issue and the workaround from its thread. The retry goes through. Offline; it does nothing until a scan exists.
- **MCP server** with `landmine_check`, `landmine_search` and `landmine_list` over the local index.

Install:

```
claude plugin marketplace add devanshranjan10/landmines
claude plugin install landmines@landmines
```

Then run `/landmines:scan` once per project (and again after dependency upgrades). The scan sends only dependency names and versions to the npm, PyPI and GitHub APIs; the hook and MCP server never touch the network.

Docs, benchmark and source: https://landmine.tech · https://github.com/devanshranjan10/landmines (MIT).
