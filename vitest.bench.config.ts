import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Standalone config for ad-hoc benchmarks (not run by `npm test`).
// Usage: npx vitest run --config vitest.bench.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/bench/**/*.bench.ts'],
    testTimeout: 120000
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core')
    }
  }
})
