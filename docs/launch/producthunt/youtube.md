# YouTube upload (for the Product Hunt video link)

Uploaded and public: https://youtu.be/CncibEdYCDc

File: `landmine-ph-launch.mp4` (1920×1080, 30 fps, H.264 + AAC, 68 s, loudness −14 LUFS for YouTube).
Visibility: **Public** or **Unlisted** (Product Hunt embeds both; Private will not play). Category: Science & Technology.
Thumbnail: YouTube picks a frame; for a custom one use `gallery/01-hook.png` (custom thumbnails need a verified
account, and YouTube wants 1280×720, so let it crop or skip this).

## Title

landmine: your coding agent doesn't know about the bug in your exact version

## Description

```
Coding agents write code against the API they remember. When the version in your lockfile has an open bug, filed upstream with a workaround in the thread, the agent has no idea.

landmine reads your lockfile, finds the open GitHub issues filed against the exact npm and PyPI versions you pin, and gives your coding agent the bug and the workaround from the thread:
• a short known-bugs section in AGENTS.md / CLAUDE.md
• a pre-edit hook for 20 agents that pauses a risky edit once, with the workaround
• an MCP server, local (npx -y landmines mcp) or hosted at https://landmine.tech/mcp

Measured on our own benchmark (landmine-bench): Claude Sonnet 5.5 went from 72/84 to 83/84 (86% → 99%) on 21 held-out traps built from bugs filed after its training cutoff. In a same-run comparison: landmine 42/42, web search 36/42, Context7 35/42, no help 35/42. With web search or Context7 available, it never used them in 84 sessions.
Caveats: it's our own benchmark; every trap was a bug landmine had already indexed, so it measures whether it helps once a bug is known, not recall; only Claude Code was benchmarked.

Across 28 popular open-source repos, the median lockfile pins 395 open GitHub issues filed against its exact versions. 30 of 40 random ones checked out by hand (about 75%).

Every terminal in the video is real output; the Claude Code sessions are real runs, replayed.

Try it:  npx landmines scan
Website: https://landmine.tech
GitHub:  https://github.com/devanshranjan10/landmines
npm:     https://www.npmjs.com/package/landmines
Free, MIT, local and read-only.

0:00 The bug is filed, the fix is in the thread
0:10 Scan your lockfile, write AGENTS.md / CLAUDE.md
0:24 The pre-edit hook in a real Claude Code session
0:36 MCP server and the benchmark
0:54 How common it is, and how to install
```

## Chapters

YouTube needs the first chapter at 0:00, at least three chapters, and each at least 10 seconds. The scenes are:
hook 0:00, problem 0:04, scan 0:10, rules 0:17, hook session 0:24, MCP 0:36, benchmark 0:45, in the wild 0:54,
end card 1:01. Several are shorter than 10 s, so the chapters above merge them.

## Tags

landmine, coding agents, Claude Code, AGENTS.md, CLAUDE.md, MCP, Model Context Protocol, npm, PyPI, lockfile,
GitHub issues, developer tools, open source

## After upload

Paste the `https://www.youtube.com/watch?v=…` link into Product Hunt's "Video" field (Media step).
