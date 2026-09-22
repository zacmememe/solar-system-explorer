import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exported source copies are review material, not a second test suite.
    exclude: [...configDefaults.exclude, 'review-exports/**'],
  },
});
