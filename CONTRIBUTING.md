# Contributing

```sh
npm ci
npm run build
npm run check          # typecheck, lint, tests: offline, with HTTP replayed from recorded fixtures
```

- **Tests never touch the network.** To change scan behaviour, record new fixtures with
  `npx tsx scripts/record-fixtures.ts` (this needs a GitHub token) and commit them.
- **Decisions go in `docs/DECISIONS.md`.** Each entry is numbered and gives the reason.
  Accuracy claims need a measurement in `docs/ACCURACY.md` or `docs/BENCHMARK.md`.
- **Adding an agent:**
  1. Payload shape: `src/hook/payload.ts`.
  2. Output format: `src/hook/respond.ts`.
  3. Config layout: `src/install.ts`.
  4. Detection: `src/agents.ts`.
  5. A payload test and an install/uninstall test: `test/harnesses.test.ts`.

  In the README's agent table, say whether it was verified live or only against
  payloads built from the docs.
- **Benchmark tasks and submissions:** see `bench/README.md`. Any new task must pass
  `scripts/bench/validate.ts`.
