import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: false,
    reporters: ['default'],
    coverage: {
      include: ['src/game/**/*.ts'],
      exclude: ['src/game/uiAtlas.ts'],
    },
  },
});
