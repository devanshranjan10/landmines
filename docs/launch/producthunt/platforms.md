# Other launch platforms

All files are in `platforms/` unless a path says otherwise. Same numbers rule as `ph-copy.md`: only 72/84 → 83/84
(86% → 99%), 36/42, 35/42, 84 sessions, 21 held-out traps, 28 repos, median 395, 30/40. Keep the caveats. Note that
`docs/launch/LAUNCH.md` also quotes "6 wins, 0 losses", "median 430.5" and "31 traps"; those are true but left out here
on purpose.

Platform limits below are as of this writing; check the upload form if something is rejected.

---

## X / Twitter

Files:
- `x-landmine-16x9.mp4`: 1920×1080, 68 s (under the 2:20 limit), 13.8 MB, loudness −16 LUFS. Attach to post 1.
- `x-card-1-hook.png`, `x-card-2-benchmark.png`, `x-card-3-28-repos.png`, `x-card-4-install.png`: 1200×675 each.

Thread:

1. Your coding agent doesn't know about the bug in your exact version.
   I built landmine to fix that, and measured whether it helps. 🧵 *(attach x-landmine-16x9.mp4)*
2. I built trap tasks from bugs filed *after* the model's training cutoff: a small project, a normal-sounding request,
   and a hidden test the naive code fails. On 21 held-out traps, Claude Sonnet 5.5 unaided passed 72/84.
3. With web search on: 36/42. With the Context7 docs MCP: 35/42. In 84 sessions it never used either one.
   It didn't think to look.
4. With landmine's known-bugs section in CLAUDE.md: 83/84. That's 86% → 99%. *(attach x-card-2-benchmark.png)*
5. How common is this? I scanned 28 popular open-source repos. The median lockfile pins 395 open GitHub issues filed
   against its exact versions. *(attach x-card-3-28-repos.png)*
6. I don't trust tools that count things, so 40 random ones were checked by hand: 30 were really filed against that
   exact version. Upstream bugs, not bugs in those projects. landmine.tech/scans
7. What it does: lockfile → open issues in your exact versions → the workaround from the thread → AGENTS.md /
   CLAUDE.md. Plus a pre-edit hook for 20 agents and an MCP server (hosted at landmine.tech/mcp).
8. Caveats: my own benchmark, only Claude Code tested, about 75% precision. Try it: `npx landmines scan`
   *(attach x-card-4-install.png)* · today on Product Hunt: <PH link>

## LinkedIn

Files:
- `linkedin-landmine-1x1.mp4`: 1080×1080, 68 s, 4.4 MB, −16 LUFS. The 16:9 video in a square frame with a header
  and footer, for the feed.
- `linkedin-1200x627.png` (product) and `linkedin-benchmark-1200x627.png` (the number): link or image posts.

Post:

> Coding agents write code against the API they remember. When the version in your lockfile has an open bug, filed on GitHub with a workaround in the thread, the agent has no idea.
>
> I built landmine, an open-source (MIT) tool that reads your lockfile, finds the open GitHub issues filed against the exact npm and PyPI versions you pin, and puts the bug and the workaround where your agent reads first: AGENTS.md / CLAUDE.md, a pre-edit hook for 20 agents, and an MCP server.
>
> On our own benchmark, Claude Sonnet 5.5 went from 86% to 99% (72/84 → 83/84) on 21 held-out traps. With web search or Context7 available, it never used them in 84 sessions.
>
> Caveats: our own benchmark, only Claude Code tested, about 75% precision.
>
> It's on Product Hunt today: <PH link> · `npx landmines scan` · landmine.tech

## Reddit

Files:
- `reddit-hook-session.gif`: 1280×720, 12.6 s, 10 fps, 11.9 MB (Reddit's image/GIF limit is 20 MB). The real Claude
  Code session: the hook pauses the edit and the agent switches to its own `pg.Pool`. Autoplays in the feed.
- `reddit-landmine-720p.mp4`: 1280×720, 68 s, 3.7 MB (video limit 1 GB / 15 min). The full launch video.

Post the GIF (or the MP4) natively and put the link in the text, not the title.

- **r/ClaudeAI.** Title: "Claude never searched for known bugs in 84 sessions, so I put them in CLAUDE.md (86% → 99%)".
  Body: the benchmark in three lines (72/84 → 83/84; web search 36/42 and Context7 35/42, never used), the caveats,
  `npx landmines scan`, and the plugin: `claude plugin marketplace add devanshranjan10/landmines`.
- **r/ChatGPTCoding, r/cursor.** Same story; lead with "works with 20 agents" and the hosted MCP config
  `{ "type": "http", "url": "https://landmine.tech/mcp" }`.
- **r/programming.** Scans angle only, no product pitch in the title: "I scanned 28 popular repos' lockfiles for open
  bugs filed against their exact versions (median 395; 30/40 checked by hand)". Link landmine.tech/scans.

## Hacker News (text only, no images)

Title (80 characters max):

> Show HN: Landmine – tell your coding agent about bugs in your pinned versions

Text:

> Coding agents write code against the API they remember. When the version in your lockfile has an open bug, filed upstream with a workaround in the thread, the agent has no idea, and it writes the code that hits it.
>
> landmine reads your lockfile, finds the open GitHub issues filed against those exact npm and PyPI versions, checks that each one really names the version, picks the workaround from the thread, and writes a short known-bugs section into AGENTS.md / CLAUDE.md. There is also a pre-edit hook for 20 agents and an MCP server (local, or hosted at https://landmine.tech/mcp).
>
> I measured it with trap tasks built from bugs filed after the model's training cutoff, each a small project with a hidden test. On the 21 held-out traps:
>
> - Claude Sonnet 5.5 unaided: 72/84. With the landmine section in CLAUDE.md: 83/84.
> - With web search on: 36/42. With the Context7 MCP: 35/42. In 84 sessions the agent never used either.
> - The pre-edit hook, the part I expected to win, did not measurably beat nothing. Telling the agent up front did.
>
> How common is this? I scanned 28 popular repos. The median lockfile pins 395 open issues filed against its exact versions. Of 40 random ones checked by hand, 30 really were filed against that version.
>
> Caveats: it's my benchmark (none existed for this); every trap was a bug landmine had already indexed, so it measures whether it helps once the bug is known, not recall; precision is about 75%; only Claude Code was benchmarked.
>
> `npx landmines scan` shows what's in yours. Code: https://github.com/devanshranjan10/landmines

URL field: https://landmine.tech (or the GitHub repo). Don't link Product Hunt from HN or ask for upvotes.

## DevHunt (devhunt.org)

- Name: landmine · Tagline: `Your coding agent doesn't know the bug in your exact version`
- Description: the 246-character description from `ph-copy.md`.
- Logo: `thumbnail/thumbnail-240.png` (or `../assets/logo-400.png` if it asks for larger).
- Images: `gallery/01-hook.png`, `02-how-it-works.png`, `06-benchmark.png`, `08-install.png`.
- Video: the YouTube link. Categories: Developer Tools, AI, Open Source. Pricing: Free.

## Uneed (uneed.best)

- Name, tagline, description as above. Logo: `thumbnail/thumbnail-240.png`.
- Images: the 8 gallery PNGs (1270×760) in order. Category: Developer Tools. Pricing: Free / Open source.

## Peerlist (Launchpad)

- Project name: landmine. Tagline as above. Description: the PH description plus the HN "Caveats" paragraph.
- Logo: `thumbnail/thumbnail-240.png`. Cover / OG image: `og-1200x630.png`. Gallery: the 8 gallery PNGs.
- Links: landmine.tech and the GitHub repo. Tech: TypeScript, Node.js, MCP.

## dev.to / Hashnode

- Cover: `devto-hashnode-cover-1000x420.png` (dev.to's size; Hashnode accepts it and crops to its 1600×840 ratio,
  so keep the headline centred if you redo it).
- Suggested title: "My coding agent never looked up known bugs, so I put them in CLAUDE.md".
- Body: the HN text, expanded, with `gallery/03-real-scan-output.png`, `04-agents-md-claude-md.png` and
  `06-benchmark.png` inline, and `reddit-hook-session.gif` for the hook.
- Tags: ai, opensource, javascript, python.

## OG card

- `og-1200x630.png`: for landmine.tech's `og:image` / `twitter:image` if you want to replace the current card, and for
  any form that asks for a 1.91:1 "social image". Not wired into the site (no site source was changed).

## GitHub social preview

- `github-social-preview-1280x640.png` (84 KB; GitHub wants 1280×640, under 1 MB).
- Repo → Settings → General → Social preview → Edit → Upload an image.
