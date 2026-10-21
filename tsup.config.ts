import { defineConfig } from 'tsup';

export default defineConfig({
  // dist/cli.js is the tiny version-checking executable; dist/main.js is the CLI it loads.
  entry: { cli: 'src/bin.ts', main: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: false,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  // Keep each entry self-contained: the version check must load nothing else.
  external: ['./main.js'],
});
