/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force all React imports (including @testing-library/react in root node_modules)
    // to resolve to the client's React 18 copy, avoiding the dual-instance useState error.
    alias: {
      react: resolve('./node_modules/react'),
      'react-dom': resolve('./node_modules/react-dom'),
      'react/jsx-runtime': resolve('./node_modules/react/jsx-runtime'),
      'react/jsx-dev-runtime': resolve('./node_modules/react/jsx-dev-runtime'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'clover', 'json-summary'],
      // Per-file gate on AdminApp only — NO global threshold (intentional).
      // Floors sit ~5 points under the measured coverage produced by the Phase 0
      // smoke/feeds characterization tests (Stmts/Lines 86.73, Branches 83.78,
      // Funcs 58.62) so they catch regressions without being brittle. NEVER 100 —
      // the smoke tests deliberately do not exercise every handler.
      thresholds: {
        'src/AdminApp.tsx': { statements: 81, functions: 53, lines: 81, branches: 78 },
      },
    },
  },
  define: {
    global: 'window',
  },
});
