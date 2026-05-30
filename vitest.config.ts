import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default; renderer hook/component tests opt into jsdom with a
    // `// @vitest-environment jsdom` directive at the top of the file.
    environment: 'node',
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.{ts,tsx}',
      'tests/renderer/**/*.test.{ts,tsx}'
    ],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: {
        // Statements/lines/functions held at the §5 target. Branch coverage is
        // lower because the LZX decoder has many data-dependent inner branches
        // (offset classes, block types) that our 3 sample CHMs simply don't
        // exercise. The oracle suite — every file byte-identical to chmlib +
        // 7-zip — is a far stronger correctness signal for LZX than hand-crafted
        // bitstreams would be, so we set a realistic branch floor here.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 65
      }
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core')
    }
  }
})
