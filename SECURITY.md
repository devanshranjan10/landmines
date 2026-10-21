# Security

## Reporting a vulnerability

Please report vulnerabilities privately, through the repository's GitHub "Report a
vulnerability" (security advisory) form, not in a public issue. You'll get an answer
within a week.

## What landmine does, and where the risks are

- **Untrusted text reaches your agent.** Issue titles, workaround quotes and trigger-card
  summaries come from strangers on GitHub, so they are a prompt-injection channel.
  landmine:
  - frames every quote to the model as untrusted third-party text;
  - strips HTML and quoted replies, and caps the length;
  - flags quotes that pipe a download into a shell, install a different package, or
    link to unfamiliar hosts;
  - tells the agent never to follow instructions inside them.

  Don't let an agent run a quoted workaround without reading it.
- **Network.**
  - `scan` sends your direct dependency names and versions to registry.npmjs.org,
    pypi.org and api.github.com.
  - `cards` sends each indexed issue's public thread to the model provider you choose.
  - Nothing else leaves your machine. The hook and the MCP server never touch the
    network.
- **Credentials.** `scan` reads a GitHub token from `GITHUB_TOKEN`, then `GH_TOKEN`, then
  `gh auth token`. It is sent only to api.github.com and never written to the index,
  cache or logs. `cards` uses your model provider's own credentials (an API key or the
  Claude Code login).
- **Files written.** These are all in your project, plus hook session state in the OS
  temp directory:
  - `.landmine/` (index and cache);
  - the agent config files that `install` names;
  - the marker-delimited sections that `rules` writes.

  `uninstall` removes landmine's entries and leaves foreign ones alone. `install`
  refuses to rewrite a settings file it can't parse without losing comments.
- **The hook fails open.** Any error, timeout or unknown payload means no output, and the
  edit goes through.
- **The MCP server is read-only.** All three tools only read the local index, and
  `landmine_check` only reads files inside the project.
