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
      // Floors sit ~5 points under the measured coverage. NEVER 100 — the smoke
      // tests deliberately do not exercise every handler.
      //
      // Phase 2 (layout extraction) re-measured: with the Stage/Console/Drawers
      // JSX moved into admin/zones/*, AdminApp.tsx is now pure orchestration that
      // the smoke tests render end-to-end, so Stmts/Lines ROSE (86.73 → 97.56) and
      // Branches rose (83.78 → 88.88). Functions DROPPED (58.62 → 33.33): the
      // inline JSX arrow-handlers the smoke clicks used to count toward AdminApp's
      // function tally now live in the zone files (and are covered by the new
      // zone tests there). This is the expected, measured shift from moving JSX
      // out — not a regression — so the functions floor is lowered to measured-
      // minus-margin (28). Floors below are measured-minus-~5.
      thresholds: {
        'src/AdminApp.tsx': { statements: 92, functions: 28, lines: 92, branches: 83 },
      },
    },
  },
  define: {
    global: 'window',
  },
});
