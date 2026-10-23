# Installing the landmine MCP server (for AI agents)

landmine finds the open GitHub issues filed against the exact dependency versions a project pins and serves them over MCP. Follow these steps in the user's project directory.

1. **Check prerequisites.** Node.js 22.12 or newer (`node --version`). A GitHub token: `GITHUB_TOKEN` or `GH_TOKEN` in the environment, or a logged-in GitHub CLI (`gh auth token` prints one). A token with no scopes is enough. If none is available, ask the user to create one at https://github.com/settings/tokens (no scopes needed) and export it as `GITHUB_TOKEN`.

2. **Build the index.** In the project root (the directory with `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `uv.lock`, `poetry.lock`, `Pipfile.lock` or pinned `requirements*.txt`), run:

   ```sh
   npx -y landmines scan
   ```

   This writes `.landmine/index.json`. It sends only dependency names and versions to the npm, PyPI and GitHub APIs.

3. **Add the MCP server** to the client's MCP settings. Use the project directory as `--root`:

   ```json
   {
     "mcpServers": {
       "landmines": {
         "command": "npx",
         "args": ["-y", "landmines", "mcp", "--root", "/absolute/path/to/the/project"]
       }
     }
   }
   ```

   No environment variables are needed: the server only reads the local index and never touches the network.

4. **Verify.** The server exposes three read-only tools:
   - `landmine_list`: the indexed issues;
   - `landmine_search`: search them by API name or error text, e.g. `{"query": "end"}`;
   - `landmine_check`: check a file in the project against them.

   Call `landmine_list`. If it reports no index, step 2 did not run in the same directory as `--root`.

Optional, recommended: `npx -y landmines rules --write AGENTS.md` writes a short known-bugs section into the agent's instructions file, which measurably helps agents avoid these bugs (https://landmine.tech/benchmark/). Re-run `scan` after dependency upgrades.
