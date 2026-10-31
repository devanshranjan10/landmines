# landmine · Product Hunt launch kit (2026-10-31)

Everything for the Product Hunt launch and the other platforms. Nothing here has been posted or uploaded.
Copy: `ph-copy.md` (Product Hunt), `youtube.md` (the video upload), `platforms.md` (X, LinkedIn, Reddit, HN, DevHunt,
Uneed, Peerlist, dev.to/Hashnode, OG, GitHub).

Every terminal and file shown is real output from landmines 0.2.2 (captured 2026-10-31); the Claude Code sessions are
real runs, replayed. Numbers come from `docs/BENCHMARK.md` and `docs/showcase/` only.

The folder is about 48 MB, mostly video. Think twice before committing the MP4s and the GIF to the repo.

## Files

| File | Size (px) | Length | File size | Use |
|---|---|---|---|---|
| `landmine-ph-launch.mp4` | 1920×1080, 30 fps, H.264 + AAC | 68 s | 14.9 MB | The launch video. Upload to YouTube (see `youtube.md`) and paste the link into PH. −14 LUFS. |
| `gallery/01-hook.png` | 1270×760 | | 111 KB | PH gallery 1: the hook. Also the PH social image if asked. |
| `gallery/02-how-it-works.png` | 1270×760 | | 131 KB | PH gallery 2: lockfile → issues → AGENTS.md/CLAUDE.md, hook, MCP. |
| `gallery/03-real-scan-output.png` | 1270×760 | | 150 KB | PH gallery 3: real `npx landmines scan` output. |
| `gallery/04-agents-md-claude-md.png` | 1270×760 | | 152 KB | PH gallery 4: the known-bugs section in CLAUDE.md / AGENTS.md. |
| `gallery/05-mcp-in-claude-code.png` | 1270×760 | | 162 KB | PH gallery 5: the hosted MCP in a real Claude Code session (vaul#492). |
| `gallery/06-benchmark.png` | 1270×760 | | 116 KB | PH gallery 6: 86% → 99%, plus the same-run comparison (42/42, 36/42, 35/42, 35/42) and the caveats. |
| `gallery/07-28-repos-median-395.png` | 1270×760 | | 111 KB | PH gallery 7: 28 repos, median 395, 30/40 hand-checked. |
| `gallery/08-install.png` | 1270×760 | | 73 KB | PH gallery 8: install in one command. |
| `thumbnail/thumbnail-240.png` | 240×240 | | 8 KB | PH thumbnail (static logo); logo for DevHunt, Uneed, Peerlist. |
| `thumbnail/thumbnail-240.gif` | 240×240, 25 fps, loops | 2 s | 121 KB | PH animated thumbnail (the trigger pulses). Under PH's 3 MB. |
| `platforms/x-landmine-16x9.mp4` | 1920×1080 | 68 s | 15.2 MB | X video (under 2:20). −16 LUFS. |
| `platforms/x-card-1-hook.png` | 1200×675 | | 101 KB | X card: the hook. |
| `platforms/x-card-2-benchmark.png` | 1200×675 | | 92 KB | X card: 86% → 99%, never used web search or Context7. |
| `platforms/x-card-3-28-repos.png` | 1200×675 | | 75 KB | X card: median 395 across 28 repos, 30/40. |
| `platforms/x-card-4-install.png` | 1200×675 | | 67 KB | X card: install. |
| `platforms/linkedin-landmine-1x1.mp4` | 1080×1080 | 68 s | 3.1 MB | LinkedIn feed video (square). −16 LUFS. |
| `platforms/linkedin-1200x627.png` | 1200×627 | | 85 KB | LinkedIn image / link post. |
| `platforms/linkedin-benchmark-1200x627.png` | 1200×627 | | 92 KB | LinkedIn image post: the benchmark. |
| `platforms/reddit-hook-session.gif` | 1280×720, 10 fps | 12.6 s | 11.9 MB | Reddit GIF (under 20 MB): the hook session. Also for dev.to. |
| `platforms/reddit-landmine-720p.mp4` | 1280×720 | 68 s | 2.9 MB | Reddit video (the full launch video, smaller). |
| `platforms/og-1200x630.png` | 1200×630 | | 85 KB | OG / Twitter card image; Peerlist cover. |
| `platforms/github-social-preview-1280x640.png` | 1280×640 | | 84 KB | GitHub repo social preview. |
| `platforms/devto-hashnode-cover-1000x420.png` | 1000×420 | | 66 KB | dev.to / Hashnode article cover. |

## Manual steps

Nothing was posted, uploaded or committed. You need to do these by hand:

1. **YouTube.** Upload `landmine-ph-launch.mp4` as Public or Unlisted, with the title, description and chapters from
   `youtube.md`. Copy the watch URL.
2. **Product Hunt** (producthunt.com → Launch, or edit the scheduled post):
   - Name, tagline (pick one of three), description, topics and links: `ph-copy.md`.
   - Thumbnail: `thumbnail/thumbnail-240.gif` (or the PNG).
   - Gallery: `gallery/01` to `08`, in that order. PH shows the first one in link previews.
   - Video: the YouTube URL from step 1.
   - After it goes live, post the maker's first comment from `ph-copy.md` and keep the Q&A answers handy.
3. **GitHub.** Repo → Settings → General → Social preview → upload `platforms/github-social-preview-1280x640.png`.
4. **X, LinkedIn, Reddit, HN, DevHunt, Uneed, Peerlist, dev.to/Hashnode.** Follow `platforms.md`. Each section lists
   which files to attach. Replace `<PH link>` with the live Product Hunt URL.
5. **Optional.** To use `platforms/og-1200x630.png` as landmine.tech's `og:image`, wire it into the site yourself; the
   site source was not changed.

## How these were made

- The video was edited in Cardboard (`landmine PH.cardboard`). Its scenes are HTML (`scenes.html`) rendered
  frame by frame in headless Chrome. The platform cuts came from Cardboard's `--preset youtube` / `--preset x` exports
  and its GIF export. The 1:1 cut is the X export placed in a square frame with ffmpeg.
- The stills are `cards.html` screenshotted with Playwright (`cards.mjs`); the animated thumbnail is `thumb.html`.
  The sources are in the scratch folder `/Volumes/Devansh/REA/scratch/landmine-launch/src/`.

## Not in git

The five MP4s and `platforms/reddit-hook-session.gif` (about 46 MB together) are gitignored and live only on this
machine. Re-render them from `/Volumes/Devansh/REA/scratch/landmine-launch/` (the Cardboard project is
`lib/landmine PH.cardboard`).
