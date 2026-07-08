import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environmentMatchGlobs: [
      ['tests/web/**/*.test.jsx', 'jsdom'],
    ],
    globals: true,
    setupFiles: [],
  },
});
