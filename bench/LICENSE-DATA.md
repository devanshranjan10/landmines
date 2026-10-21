# License for landmine-bench task data

The task data in `bench/tasks/` is licensed under the Creative Commons Attribution 4.0
International License (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/
- `task.json`
- `prompt.txt` and `prompt-terse.txt`
- `project/`, `hidden/` and `reference/`, excluding installed `node_modules`

**Attribution:** "landmine-bench" (landmine project).

**Code.** The runner and scripts in `scripts/bench/` and `bench/setup.sh` are MIT, like
the rest of the repository (see `LICENSE`).

**Third-party content.**
- `bench/fixtures/cache/` and `bench/fixtures/noise-fresh-a.json` contain public GitHub
  issue and comment text, copyright its authors. The text is cached so the benchmark's
  landmine arms run offline and reproducibly, and each item links to its source issue.
  Authors can ask for removal.
- `bench/fixtures/cards/` holds model-written summaries of those issues.
- The task projects pin third-party packages under their own licenses. They are
  installed from npm and PyPI by `bench/setup.sh`, not vendored.
