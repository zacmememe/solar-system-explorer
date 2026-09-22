import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exported source copies and handoff docs are review material, not Vitest suites.
    exclude: [...configDefaults.exclude, 'review-exports/**', 'docs/**', '前置方案打磨/**'],
  },
});
