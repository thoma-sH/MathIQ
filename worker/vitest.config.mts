import { defineConfig } from 'vitest/config';

// Without a config here, Vitest walks up and picks up the frontend's
// vite.config.ts — pulling the React plugin into worker tests that have
// nothing to do with React. This pins the worker suite to itself.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
