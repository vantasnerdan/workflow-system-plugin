import { defineConfig } from 'vitest/config';

/** Unit tests only: they run against a fake site (plugins/mcp/test/fake-site.ts) and need no database. */
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'plugins/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
