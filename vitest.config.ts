import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/globalSetup.ts'],
    environment: 'node',
  },
});
